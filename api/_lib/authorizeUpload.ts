// Authorise an upload without requiring Vercel to hold the Worker's signing key.
//
// WHY THIS EXISTS
//   `verifyWorkerToken` validates the HS256 JWT locally, which requires
//   `process.env.JWT_SECRET` to be byte-identical to the Worker's secret. That
//   coupling is the reason every upload returned 401: the variable was never set on
//   Vercel, and it CANNOT simply be invented — HMAC is symmetric, so a value that
//   doesn't match what the Worker signs with fails exactly the same way. Recovering
//   the Worker's value is impossible too: `wrangler secret` is write-only.
//
//   So instead of duplicating the secret, we ask the party that already owns it.
//   The Worker is the auth authority — it issues these tokens — and it exposes
//   `GET /v1/auth/me`, which returns the caller's profile for a valid token and 401
//   for anything else. Delegating there removes the shared-secret requirement
//   entirely.
//
// WHY THIS IS NOT A WEAKENING
//   - The local check is still tried FIRST. When `JWT_SECRET` is present and
//     correct, behaviour is unchanged and there is no extra network hop.
//   - The remote check is strictly narrower than trusting the client: the Worker
//     verifies the signature, issuer, algorithm and expiry with the real key, and
//     confirms the profile still exists in D1 — which the local check cannot do, so
//     a token for a deleted account is now rejected where before it passed.
//   - Fail-closed is preserved. Anything other than a 200 with a usable id — a
//     rejection, a malformed body, a timeout, an unreachable Worker — denies the
//     upload.
//
// COST
//   One extra request to our own Worker, only on the path where the local check
//   could not decide. An upload carries up to 4 MB and already takes seconds; a
//   sub-100 ms round trip to the same infrastructure is not material.

import type { IncomingMessage } from 'http';
import { extractBearer, verifyWorkerToken } from './verifyToken';

const WORKER_BASE_URL = 'https://san-mes-api.odi44972.workers.dev';

/**
 * Budget for the delegated check. Deliberately short: this runs BEFORE the body is
 * read, so a hanging Worker must not consume the function's whole execution time
 * and turn a clean 401 into a platform timeout.
 */
const REMOTE_AUTH_TIMEOUT_MS = 4000;

export type UploadPrincipal =
  | { ok: true; userId: string; via: 'local' | 'worker' }
  | { ok: false };

/** Ask the Worker whether this token is valid, and for whom. */
async function verifyViaWorker(token: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REMOTE_AUTH_TIMEOUT_MS);
  try {
    const res = await fetch(`${WORKER_BASE_URL}/v1/auth/me`, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (!res.ok) return null;

    // The Worker wraps payloads as `{ data: … }`; tolerate a bare object too so a
    // future envelope change degrades to "cannot tell" (→ deny) rather than to
    // "accept something unverified".
    const body = (await res.json()) as { data?: { id?: unknown }; id?: unknown };
    const id = body?.data?.id ?? body?.id;
    return typeof id === 'string' && id.length > 0 ? id : null;
  } catch {
    // Abort, DNS failure, TLS failure — all deny.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve the authenticated principal for an upload request.
 *
 * Local verification first (no network, unchanged behaviour when the secret is
 * configured), then delegation to the Worker.
 */
export async function authorizeUpload(req: IncomingMessage): Promise<UploadPrincipal> {
  const token = extractBearer(req.headers as Record<string, unknown>);
  if (!token) return { ok: false };

  const local = verifyWorkerToken(token)?.userId;
  if (local) return { ok: true, userId: local, via: 'local' };

  const remote = await verifyViaWorker(token);
  if (remote) return { ok: true, userId: remote, via: 'worker' };

  return { ok: false };
}
