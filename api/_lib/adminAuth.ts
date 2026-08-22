// Shared admin-key gate for the Vercel `/api/admin/*` functions.
//
// Extracted so the constant-time comparison exists in exactly ONE place. Two
// hand-rolled copies of a timing-safe compare is how one of them ends up subtly
// wrong (a `!==` fast path, a missing length check) while still looking correct.
//
// Contract, deliberately fail-closed:
//   - No `ADMIN_KEY` in the environment  → `not_configured`. There is no correct
//     key, so the endpoint is unavailable rather than open. The previous
//     literal-constant fallback effectively made it open; it is not coming back.
//   - Key present but wrong             → `wrong_key`.
//   - Key matches                       → `ok`.
//
// Callers map these to status codes. The distinction between `not_configured`
// (503) and `wrong_key` (401) is intentional and is the whole point: without it,
// "the operator mistyped the password" and "the environment variable was never
// set" are the same opaque failure, which is exactly why the admin panel read as
// "something is wrong with the hosting".

import crypto from 'crypto';
import type { IncomingMessage } from 'http';

export type AdminGate =
  | { kind: 'ok'; adminKey: string }
  | { kind: 'not_configured' }
  | { kind: 'wrong_key' };

/**
 * Compare the request's `x-admin-key` against `process.env.ADMIN_KEY`.
 *
 * Constant-time so the endpoint cannot be probed one byte at a time through
 * response timing. Lengths are compared first because `timingSafeEqual` throws on
 * a length mismatch — lengths are not secret.
 */
export function checkAdminKey(req: IncomingMessage): AdminGate {
  const expected = process.env.ADMIN_KEY || '';
  if (!expected) return { kind: 'not_configured' };

  const provided = Buffer.from((req.headers['x-admin-key'] as string) || '');
  const expectedBuf = Buffer.from(expected);

  const match =
    provided.length === expectedBuf.length && crypto.timingSafeEqual(provided, expectedBuf);

  return match ? { kind: 'ok', adminKey: expected } : { kind: 'wrong_key' };
}
