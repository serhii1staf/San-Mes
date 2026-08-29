// Worker-issued JWT verification + signing.
//
// Phase 6 of the D1 migration: the Worker is now the auth authority.
// We sign HS256 JWTs with a Worker secret (`JWT_SECRET`) on every
// register / login / refresh, and verify the same secret on every
// authed request. The previous JWKS-against-Supabase path is dead —
// nothing in the app talks to Supabase Auth anymore.
//
// The verify call must NEVER throw. Endpoints branch on a `null`
// return as "anonymous"; the central fetch handler simply omits an
// `authedUserId` if the bearer token doesn't validate. That keeps
// public reads (feed, profiles) serving even if the user's token has
// rotted.
//
// Token format:
//   header  { alg: 'HS256', typ: 'JWT' }
//   payload { sub: <profile.id>, iss: 'san-mes-api', iat, exp = iat + 30d }
// Signing key: 32-byte random hex provisioned via `wrangler secret put JWT_SECRET`.

import { jwtVerify, SignJWT } from 'jose';
import type { Env } from './db';

const ISSUER = 'san-mes-api';
const TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

function getSecret(env: Env): Uint8Array {
  const secret = env.JWT_SECRET;
  if (!secret) {
    // Surfaced as a 500 rather than a silent anonymous fall-through:
    // a missing secret is a deploy-config bug, not a runtime input
    // problem. Throwing here makes it loud.
    throw new Error('JWT_SECRET is not configured');
  }
  return new TextEncoder().encode(secret);
}

export interface VerifiedToken {
  userId: string;
  /**
   * The install this token was issued to, when it carries one.
   *
   * Added so "disconnect this device" can actually sign a device out. `null` for every token minted
   * before this claim existed — those cannot be attributed to an install, so they are not checked
   * against the revocation list and simply expire (30 days). Any token issued from now on carries it,
   * because register / login / refresh all pass the client's install id through.
   *
   * It is a CLAIM, so the client cannot change it: the value is inside the HMAC signature. That is what
   * makes the check meaningful rather than cooperative — a revoked device cannot present someone
   * else's install id, and cannot strip its own without invalidating the token.
   */
  installId: string | null;
  raw: Record<string, unknown>;
}

/**
 * Verify a Worker-issued JWT. Returns the user id (sub claim) on
 * success, or `null` on any failure (expired, malformed, wrong issuer,
 * signature mismatch). Never throws — endpoints rely on a `null`
 * return to mean "treat as anonymous".
 */
export async function verifyToken(
  env: Env,
  token: string | null | undefined,
): Promise<VerifiedToken | null> {
  if (!token) return null;
  // If JWT_SECRET isn't set we can't verify anything — treat as
  // anonymous instead of throwing on every request. The fetch handler
  // catches the throw from `getSecret`, but we'd rather skip the call
  // entirely.
  if (!env.JWT_SECRET) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret(env), {
      issuer: ISSUER,
      algorithms: ['HS256'],
    });
    const sub = typeof payload.sub === 'string' ? payload.sub : null;
    if (!sub) return null;
    const inst = typeof payload.install === 'string' && payload.install.length > 0 ? payload.install : null;
    return { userId: sub, installId: inst, raw: payload as Record<string, unknown> };
  } catch {
    return null;
  }
}

/**
 * Sign a fresh 30-day JWT for the given user id. Used by the
 * register / login / refresh endpoints in `routes/auth.ts`.
 *
 * `installId` binds the token to one install so revocation can be enforced. Optional because an old
 * client does not send one and must keep working; a token without it is simply unattributable and
 * therefore unrevokable, which is why the client sends it on every auth call.
 */
export async function signToken(env: Env, userId: string, installId?: string | null): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  // A short claim name. This goes in every request header for 30 days, so the byte matters more here
  // than the readability does.
  const claims: Record<string, unknown> = installId ? { install: installId } : {};
  return await new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(ISSUER)
    .setSubject(userId)
    .setIssuedAt(now)
    .setExpirationTime(now + TOKEN_TTL_SECONDS)
    .sign(getSecret(env));
}

/** Extract the bearer token from a request, or `null` if absent. */
export function extractBearer(req: Request): string | null {
  const auth = req.headers.get('Authorization') || req.headers.get('authorization');
  if (!auth) return null;
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}
