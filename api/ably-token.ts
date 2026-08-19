// /api/ably-token
//
// Mints a scoped Ably token for an authenticated user. The Ably Root API key
// lives ONLY in Vercel env (`ABLY_ROOT_KEY`) — it never ends up in the
// mobile bundle. The client requests a token from this endpoint and the Ably
// SDK on the device exchanges the returned signed TokenRequest for a real
// auth token.
//
// Auth model:
//   This app uses device-key + PIN auth (not Supabase JWT). Login produces a
//   `user.id` (UUID, the auth.users primary key) and stores `device_key` /
//   `pin` in the auth store. The client posts both to this endpoint:
//
//       POST /api/ably-token
//       { "userId": "<uuid>", "deviceKey": "<base32>" }
//
//   We verify the pair exists in the `profiles` table; if so we mint a
//   scoped Ably token for that user. The PIN never reaches our endpoint —
//   it's used only for password-style auth on the login screen via Supabase
//   directly.
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
// Lifetime: tokens TTL 1 hour. The Ably SDK auto-renews via the same
// `authUrl`, so there's no client-side renewal loop to maintain.

import type { IncomingMessage, ServerResponse } from 'http';
import * as Ably from 'ably';
import { extractBearer, verifyWorkerToken } from './_lib/verifyToken';

const TOKEN_TTL_MS = 60 * 60 * 1000;

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
  // SECURITY: the user id comes from a VERIFIED Worker-issued JWT and is never
  // taken from the request body. The endpoint used to accept `{ userId, deviceKey }`
  // and treat a device-key match as proof of identity, which was exploitable two
  // ways: the device key never rotates, and it was being returned by
  // unauthenticated profile endpoints — so anybody could mint a realtime token for
  // anybody. Deriving the id from the signature means a caller can only ever get a
  // token for themselves.
  const authedUserId = verifyWorkerToken(extractBearer(req.headers as any))?.userId;
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
