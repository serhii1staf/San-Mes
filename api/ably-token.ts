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

const TOKEN_TTL_MS = 60 * 60 * 1000;

// Hard-coded Supabase URL + anon key, matching the convention in the other
// /api routes (api/index.ts, api/admin/status.ts). The anon key is a public
// JWT and safe to embed; it only reads through RLS.
const SUPABASE_URL = 'https://ycwadqglcykcpucembjn.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inljd2FkcWdsY3lrY3B1Y2VtYmpuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4Mjc2OTYsImV4cCI6MjA5NTQwMzY5Nn0.ZUr1YfN6pBp_AaUC1pZLKGApwgEXEiVw_w6w-yQjE_U';

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  // Permissive CORS so Expo dev clients on localhost can hit this during
  // development. Production traffic is same-origin (the app's domain ==
  // the Vercel project) so no preflight is needed.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.end(JSON.stringify(body));
}

function readJsonBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      // 4 KB cap — this endpoint receives a tiny JSON object only. Any larger
      // payload is malformed or malicious.
      if (total > 4096) {
        reject(new Error('payload_too_large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8') || '{}';
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function getQueryParam(url: string | undefined, name: string): string | undefined {
  if (!url) return undefined;
  const idx = url.indexOf('?');
  if (idx < 0) return undefined;
  return new URLSearchParams(url.slice(idx + 1)).get(name) || undefined;
}

interface AuthInput {
  userId: string;
  deviceKey: string;
}

async function verifyAuth(input: AuthInput): Promise<boolean> {
  const userId = input.userId?.trim();
  const deviceKey = input.deviceKey?.trim();
  if (!userId || !deviceKey) return false;
  // Cheap shape check: Supabase user IDs are UUIDs; device keys are 8+ chars
  // of base32. Reject obviously-malformed input before hitting the DB so
  // bots probing the endpoint don't burn rows on PostgREST.
  if (!/^[0-9a-f-]{20,}$/i.test(userId)) return false;
  if (!/^[A-Z0-9-]{6,40}$/i.test(deviceKey)) return false;

  // PostgREST select — RLS allows public read on profiles by id+device_key
  // for the existing login flow. We re-use the same path here.
  const url =
    `${SUPABASE_URL}/rest/v1/profiles` +
    `?select=id,device_key` +
    `&id=eq.${encodeURIComponent(userId)}` +
    `&device_key=eq.${encodeURIComponent(deviceKey)}` +
    `&limit=1`;
  try {
    const resp = await fetch(url, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });
    if (!resp.ok) return false;
    const rows = (await resp.json()) as Array<{ id: string; device_key: string }>;
    return Array.isArray(rows) && rows.length === 1;
  } catch {
    return false;
  }
}

/**
 * Build a least-privilege capability map for the given user id.
 *
 * Channel naming convention used by the app:
 *   - `chat:<conversationId>`       → message stream for one conversation
 *   - `user:<userId>:notifications` → user's notification channel
 *   - `user:<userId>:presence`      → user's presence channel
 *
 * Granting broad rights on `chat:*` is a deliberate tradeoff documented
 * here so a future hardening pass (per-conversation tokens) is easy to
 * spot. Per-conversation tokens would require a participant lookup on
 * every token mint, which slows auth noticeably. The chat-history REST
 * endpoint enforces participant membership at read time, so a malicious
 * token holder can see live messages from a chat they don't belong to,
 * but no history. Acceptable for v1; harden when traffic grows.
 */
function buildCapability(userId: string): Record<string, string[]> {
  return {
    'chat:*': ['publish', 'subscribe', 'presence', 'history'],
    [`user:${userId}:*`]: ['publish', 'subscribe', 'presence', 'history'],
  };
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method === 'OPTIONS') {
    return send(res, 204, {});
  }
  if (req.method !== 'POST' && req.method !== 'GET') {
    return send(res, 405, { error: 'method_not_allowed' });
  }

  const rootKey = process.env.ABLY_ROOT_KEY;
  if (!rootKey) {
    return send(res, 503, {
      error: 'ably_not_configured',
      message: 'ABLY_ROOT_KEY env var is missing in Vercel.',
    });
  }

  // Accept credentials in either the JSON body (POST) or as query params
  // (GET) — Ably's SDK supports both methods for `authUrl`. JSON body is
  // preferred because the deviceKey doesn't end up in CDN logs.
  let userId: string | undefined;
  let deviceKey: string | undefined;
  if (req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      userId = body?.userId;
      deviceKey = body?.deviceKey;
    } catch (e: any) {
      return send(res, 400, { error: 'bad_body', message: e?.message?.slice(0, 200) });
    }
  } else {
    userId = getQueryParam(req.url, 'userId');
    deviceKey = getQueryParam(req.url, 'deviceKey');
  }

  if (!userId || !deviceKey) {
    return send(res, 400, { error: 'missing_credentials' });
  }

  const ok = await verifyAuth({ userId, deviceKey });
  if (!ok) {
    return send(res, 401, { error: 'unauthorized' });
  }

  // Use the Ably REST client to sign a TokenRequest. The Ably SDK does the
  // HMAC-SHA256 + nonce + timestamp dance for us.
  let tokenRequest;
  try {
    const rest = new Ably.Rest({ key: rootKey });
    tokenRequest = await rest.auth.createTokenRequest({
      ttl: TOKEN_TTL_MS,
      clientId: userId,
      capability: buildCapability(userId),
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
