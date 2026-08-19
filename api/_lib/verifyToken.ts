// Verify a Worker-issued JWT inside a Vercel serverless function.
//
// The Cloudflare Worker is the auth authority: it signs HS256 JWTs with the shared
// `JWT_SECRET` on register / login (see `workers/api/src/auth.ts`). Any Vercel
// endpoint that performs a privileged action on a user's behalf must verify that
// same token instead of trusting values the client sends about itself.
//
// Implemented with Node's built-in `crypto` rather than `jose`: the whole job is one
// HMAC-SHA256 and two base64url decodes, and the Vercel functions have no bundler
// step, so avoiding a dependency keeps cold starts and the deploy surface small.
//
// Contract mirrors the Worker's `verifyToken`: NEVER throws, returns `null` on any
// failure (missing/malformed token, bad signature, wrong issuer, expired, no `sub`).
// Callers decide whether `null` means 401 or "anonymous".

import crypto from 'crypto';

const ISSUER = 'san-mes-api';

/** Decode a base64url segment to a Buffer. Returns null on malformed input. */
function b64urlDecode(segment: string): Buffer | null {
  if (!segment || /[^A-Za-z0-9_-]/.test(segment)) return null;
  try {
    return Buffer.from(segment.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  } catch {
    return null;
  }
}

export interface VerifiedToken {
  userId: string;
}

/**
 * Verify an HS256 JWT signed by the Worker.
 *
 * Fails closed when `JWT_SECRET` is not configured — an endpoint that cannot verify
 * identity must reject, not wave callers through.
 */
export function verifyWorkerToken(token: string | null | undefined): VerifiedToken | null {
  const secret = process.env.JWT_SECRET;
  if (!secret || !token) return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = parts;

  // Signature first: never parse attacker-controlled JSON we have not
  // authenticated. Constant-time compare so the check cannot be probed byte by
  // byte through timing.
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest();
  const provided = b64urlDecode(signatureB64);
  if (!provided || provided.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(provided, expected)) return null;

  const headerRaw = b64urlDecode(headerB64);
  const payloadRaw = b64urlDecode(payloadB64);
  if (!headerRaw || !payloadRaw) return null;

  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(headerRaw.toString('utf8'));
    payload = JSON.parse(payloadRaw.toString('utf8'));
  } catch {
    return null;
  }

  // Pin the algorithm. Without this an `alg: none` or `alg: RS256` header could be
  // used to sidestep the HMAC check in a less careful implementation; we verify
  // HS256 unconditionally above, so this is belt-and-braces.
  if (header.alg !== 'HS256') return null;
  if (payload.iss !== ISSUER) return null;

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === 'number' && payload.exp <= now) return null;
  // `nbf` is not issued by the Worker today, but honour it if it ever appears.
  if (typeof payload.nbf === 'number' && payload.nbf > now) return null;

  const sub = typeof payload.sub === 'string' ? payload.sub : null;
  if (!sub) return null;

  return { userId: sub };
}

/** Extract the bearer token from a Node request's headers, or null. */
export function extractBearer(headers: Record<string, unknown> | undefined): string | null {
  const raw = (headers?.authorization ?? headers?.Authorization) as string | undefined;
  if (!raw) return null;
  const m = raw.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}
