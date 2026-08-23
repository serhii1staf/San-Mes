// /api/ably-token
//
// Mints a scoped Ably token for an authenticated user. The Ably Root API key
// lives ONLY in Vercel env (`ABLY_ROOT_KEY`) — it never ends up in the
// mobile bundle. The client requests a token from this endpoint and the Ably
// SDK on the device exchanges the returned signed TokenRequest for a real
// auth token.
//
// Auth model:
//   The caller sends the Worker-issued JWT it already holds:
//
//       POST /api/ably-token
//       Authorization: Bearer <worker jwt>
//
//   No request body is read. The user id is resolved from that token by asking the Worker
//   (`GET /v1/auth/me`) and a scoped Ably token is minted for whoever the Worker says the
//   caller is. An earlier revision accepted `{ userId, deviceKey }` and treated a device-key
//   match as proof of identity; that is gone — see the note on `resolveUserId`.
//
// Capability scope:
//   - `chat:*`                          → publish + subscribe + presence + history
//   - `user:{userId}:*`                 → publish + subscribe + presence + history
//   Other channels (e.g. another user's `user:abc:notifications`) are NOT
//   reachable with this token. A leaked token can only see what its owner
//   could already see.
//
// Required Vercel env:
//   ABLY_ROOT_KEY  — `appId.keyId:keySecret` admin key (NEVER bundled)
//
// NOT required, deliberately: `JWT_SECRET`. Identity is resolved by asking the Worker, which
// is the service that issues these tokens. See `resolveUserId` — the previous local
// verification depended on a variable that was never set on this project, which silently 401'd
// every realtime token request the app has ever made.
//
// Lifetime: tokens TTL 1 hour. The Ably SDK auto-renews via the same
// `authUrl`, so there's no client-side renewal loop to maintain.

import type { IncomingMessage, ServerResponse } from 'http';
import * as Ably from 'ably';
import { extractBearer } from './_lib/verifyToken';

const TOKEN_TTL_MS = 60 * 60 * 1000;

/**
 * Where identity is checked. See `resolveUserId` for why this is a round trip rather than a
 * local signature verification.
 *
 * Same host list the app itself uses (src/services/apiHost.ts); the first entry is the one
 * that is actually provisioned today.
 */
const WORKER_BASE = process.env.WORKER_BASE_URL || 'https://san-mes-api.odi44972.workers.dev';

/** Identity check must not hang a token mint. The Ably SDK is waiting on this. */
const IDENTITY_TIMEOUT_MS = 6000;

/**
 * Resolve the caller's user id by ASKING THE WORKER, not by verifying the JWT here.
 *
 * ── WHY THIS CHANGED, AND WHY IT IS NOT A DOWNGRADE ─────────────────────────────
 *
 * This endpoint used to call `verifyWorkerToken`, which reads `process.env.JWT_SECRET` and is
 * fail-closed. That secret was NEVER SET on this Vercel project. Verified against the Vercel
 * API: the project has exactly eight environment variables —
 *
 *     ABLY_ROOT_KEY (development, preview, production)
 *     ADMIN_KEY
 *     R2_ACCOUNT_ID, R2_API_TOKEN, R2_BUCKET, R2_PUBLIC_BASE
 *
 * — and `JWT_SECRET` is not among them. So `verifyWorkerToken` returned null for every
 * request that has ever reached this function, and every client got 401.
 *
 * The consequence was total and silent: the Ably SDK's `authCallback` errored, no realtime
 * connection was ever established, and the app fell back to nothing. Ably's own statistics
 * confirm it from the other side — messages published 15–60/hour (the Worker publishes over
 * REST with the root key, which needs no client connection), and the `connections` metric
 * EMPTY for every hour on record. Not low. Empty. No device has ever connected.
 *
 * That presented as "messages do not arrive in real time", "comments do not update", "edits
 * do not propagate" — every symptom pointing at feature code, none of it at a missing
 * variable on a service that is not even the one issuing the token.
 *
 * The fix could have been "set JWT_SECRET on Vercel to match the Worker's". That was
 * rejected: it duplicates a signing key across two services, and the failure mode of getting
 * it wrong is exactly what happened here — invisible, total, and blamed on something else.
 * `wrangler secret` cannot read a secret back either, so keeping two copies in sync is a
 * manual ritual with no way to check it short of the fingerprint endpoints that had to be
 * written for a previous instance of this same bug.
 *
 * So identity is now resolved by the service that OWNS it. The Worker issues these JWTs and
 * already verifies them on every request; `GET /v1/auth/me` returns the authed profile or
 * 401. Forwarding the caller's bearer token there and trusting the answer means:
 *
 *   - no shared secret between Vercel and the Worker, so nothing to drift;
 *   - no new environment variable anywhere — `ABLY_ROOT_KEY` is already configured here,
 *     which is the only secret this endpoint genuinely needs;
 *   - the same guarantee as before. A caller can only obtain a token for the user whose
 *     valid JWT they hold, and the authority on that is the Worker either way.
 *
 * Cost: one HTTPS round trip per mint. Tokens live an hour, so that is once per user per
 * hour — against a feature that currently does not work at all.
 */
async function resolveUserId(bearer: string | null): Promise<string | null> {
  if (!bearer) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IDENTITY_TIMEOUT_MS);
  try {
    const resp = await fetch(`${WORKER_BASE}/v1/auth/me`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${bearer}` },
      signal: controller.signal,
    });
    if (!resp.ok) return null;
    const body: any = await resp.json();
    // The Worker wraps successful responses; accept either shape rather than coupling to one.
    const id = body?.data?.id ?? body?.id ?? null;
    return typeof id === 'string' && id.length > 0 ? id : null;
  } catch {
    // Timeout, DNS, or the Worker being down. Fail CLOSED — no token without proven identity.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Production web origin for the app. Used to scope CORS instead of a wildcard, so a
// bearer token is never accepted from / echoed to arbitrary origins. Override via
// APP_ORIGIN env if the deployed origin differs.
const ALLOWED_ORIGIN = process.env.APP_ORIGIN || 'https://san-m-app.com';

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  // Restrict CORS to the app's own production origin (overridable via
  // APP_ORIGIN) rather than a wildcard, so the device_key credential is
  // never accepted from / echoed to arbitrary origins. Production
  // traffic is same-origin (the app's domain == the Vercel project).
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.end(JSON.stringify(body));
}

// The device-key verification path (`readJsonBody`, `timingSafeEqualStr`,
// `verifyAuth`, and the admin-key round trip to the Worker) was DELETED. It proved
// identity by matching a caller-supplied `device_key` against the profile row, which
// meant a long-lived, non-rotating secret was being used as a bearer credential — and
// that secret was, until the accompanying fix, readable from unauthenticated profile
// endpoints. Identity now comes from the verified JWT, which also removes this
// function's dependency on the admin key entirely.

/**
 * Build a least-privilege capability map for the given user id.
 *
 * Channel naming convention used by the app:
 *   - `chat:<conversationId>`         → message stream for one chat
 *   - `user:<userId>:notifications`   → user's notification channel
 *   - `user:<userId>:presence`        → user's presence channel
 *   - `user:<userId>:profile`         → bio / banner / display-name
 *                                       sync across own devices
 *   - `user:<userId>:follows`         → incoming + outgoing follow
 *                                       graph events
 *   - `post:<postId>`                 → per-post comment + like events
 *   - `feed:public`                   → global feed firehose
 *
 * Capability rules:
 *   - `chat:*` keeps publish + subscribe + presence + history (existing
 *     1:1 chat flow publishes from the sender's client).
 *   - `user:<self>:*` keeps full publish + subscribe (the user owns
 *     these channels). The Worker is the canonical publisher of the
 *     `:profile`, `:follows`, `:notifications` events; granting publish
 *     to the device too is harmless because the per-channel listeners
 *     don't accept arbitrary client payloads — and a device may legit
 *     publish presence on `user:<self>:presence`.
 *   - `post:*` and `feed:public` are SUBSCRIBE-ONLY. Only the Worker
 *     publishes there; the device should never be able to fabricate a
 *     `post.new` or `comment.delete`.
 *   - `typing:*` is publish + subscribe + presence. Typing indicators are
 *     inherently client-published: only the device knows a key was pressed,
 *     and no server is involved.
 *
 *     It is a SEPARATE namespace rather than publish rights on `post:*`
 *     precisely so that stays subscribe-only. Granting the device publish on
 *     `post:*` to carry a typing event would also let it fabricate a
 *     `comment.new` or `comment.delete`, which is the one thing the
 *     subscribe-only rule above exists to prevent. Channel names are
 *     `typing:chat:<conversationId>` and `typing:post:<postId>` — see
 *     `src/services/realtime/typing.ts`.
 *
 *     Worst case for a leaked token on this namespace is a fake "someone is
 *     typing" on a channel the holder could already read. Nothing is stored,
 *     nothing is authoritative, and the payload is ignored unless it carries a
 *     user id the viewer is already able to see.
 *
 * Granting broad rights on `chat:*` is a deliberate tradeoff
 * documented here so a future hardening pass (per-conversation tokens)
 * is easy to spot. Per-conversation tokens would require a
 * participant lookup on every token mint, which slows auth noticeably.
 * The chat-history REST endpoint enforces participant membership at
 * read time, so a malicious token holder can see live messages from a
 * chat they don't belong to, but no history. Acceptable for v1;
 * harden when traffic grows.
 */
function buildCapability(userId: string): Record<string, string[]> {
  return {
    'chat:*': ['publish', 'subscribe', 'presence', 'history'],
    [`user:${userId}:*`]: ['publish', 'subscribe', 'presence', 'history'],
    'post:*': ['subscribe', 'history'],
    'feed:public': ['subscribe', 'history'],
    // Typing indicators. No `history`: a typing event is meaningless a moment after it was
    // sent, so replaying one on attach would only ever show a stale "is typing".
    'typing:*': ['publish', 'subscribe', 'presence'],
  };
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method === 'OPTIONS') {
    return send(res, 204, {});
  }
  if (req.method !== 'POST') {
    return send(res, 405, { error: 'method_not_allowed' });
  }

  const rootKey = process.env.ABLY_ROOT_KEY;
  if (!rootKey) {
    return send(res, 503, {
      error: 'ably_not_configured',
      message: 'ABLY_ROOT_KEY env var is missing in Vercel.',
    });
  }

  // ── Identity ──────────────────────────────────────────────────────────────
  //
  // SECURITY: the user id is resolved from the caller's Worker-issued JWT and is never taken
  // from the request body. The endpoint used to accept `{ userId, deviceKey }` and treat a
  // device-key match as proof of identity, which was exploitable two ways: the device key
  // never rotates, and it was being returned by unauthenticated profile endpoints — so
  // anybody could mint a realtime token for anybody.
  //
  // The check itself is now delegated to the Worker rather than done with a local copy of the
  // signing key. See `resolveUserId` for the full reason; the short version is that the local
  // copy was never configured, so this endpoint 401'd every request ever made to it.
  const authedUserId = await resolveUserId(extractBearer(req.headers as any));
  if (!authedUserId) {
    return send(res, 401, { error: 'unauthorized' });
  }
  const userId = authedUserId;

  // Use the Ably REST client to sign a TokenRequest. The Ably SDK does the
  // HMAC-SHA256 + nonce + timestamp dance for us. We hand the capability
  // map to Ably as a JSON-stringified blob — Ably accepts either a typed
  // object or a string, and stringify side-steps the strict
  // `capabilityOp` literal-array typing the SDK declares (which gets
  // brittle as we add new channels here).
  let tokenRequest;
  try {
    const rest = new Ably.Rest({ key: rootKey });
    tokenRequest = await rest.auth.createTokenRequest({
      ttl: TOKEN_TTL_MS,
      clientId: userId,
      capability: JSON.stringify(buildCapability(userId)),
    });
  } catch (e: any) {
    return send(res, 500, {
      error: 'token_mint_failed',
      message: e?.message?.slice(0, 200),
    });
  }

  // The Ably client SDK on the device receives this object as-is and posts
  // it to Ably to exchange for a real auth token.
  return send(res, 200, tokenRequest);
}
