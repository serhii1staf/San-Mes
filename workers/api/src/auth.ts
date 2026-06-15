// JWT verification against the Supabase project's JWKS endpoint.
//
// The app sends `Authorization: Bearer <jwt>` on every authenticated
// request. We pass the token through `jose.jwtVerify` against the
// public JWKS (no shared secret needs to live in the Worker — we only
// need the public key to validate the signature). Returns `null` on
// any failure so endpoints can branch cleanly into anonymous mode.
//
// JWKS is cached at module scope. Workers reuse module instances across
// requests within a single isolate, so the second request inside the
// same isolate avoids the network fetch entirely. We re-fetch every 24h
// so a key rotation eventually heals on its own.

import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Env } from './db';

interface CachedJwks {
  jwks: ReturnType<typeof createRemoteJWKSet>;
  fetchedAt: number;
  issuer: string;
}

const JWKS_TTL_MS = 24 * 60 * 60 * 1000; // 24h

declare global {
  // eslint-disable-next-line no-var
  var __jwksCache: CachedJwks | undefined;
}

function getJwks(env: Env): CachedJwks {
  const issuer = `https://${env.SUPABASE_PROJECT_REF}.supabase.co/auth/v1`;
  const cached = globalThis.__jwksCache;
  if (cached && cached.issuer === issuer && Date.now() - cached.fetchedAt < JWKS_TTL_MS) {
    return cached;
  }
  // Supabase exposes its JWKS at `/.well-known/jwks.json` under the project
  // domain. `createRemoteJWKSet` does the actual fetch lazily on the first
  // verification call, with built-in caching.
  const jwksUrl = new URL(`https://${env.SUPABASE_PROJECT_REF}.supabase.co/auth/v1/.well-known/jwks.json`);
  const fresh: CachedJwks = {
    jwks: createRemoteJWKSet(jwksUrl, { cacheMaxAge: JWKS_TTL_MS }),
    fetchedAt: Date.now(),
    issuer,
  };
  globalThis.__jwksCache = fresh;
  return fresh;
}

export interface VerifiedToken {
  userId: string;
  raw: Record<string, unknown>;
}

/**
 * Verify a Supabase-issued JWT. Returns the user id (sub claim) on
 * success, or `null` on any failure (expired, malformed, wrong issuer,
 * signature mismatch). The function never throws.
 */
export async function verifyToken(
  env: Env,
  token: string | null | undefined,
): Promise<VerifiedToken | null> {
  if (!token) return null;
  try {
    const { jwks, issuer } = getJwks(env);
    const { payload } = await jwtVerify(token, jwks, {
      issuer,
      // Supabase JWTs use the `authenticated` audience for end users.
      audience: 'authenticated',
    });
    const sub = typeof payload.sub === 'string' ? payload.sub : null;
    if (!sub) return null;
    return { userId: sub, raw: payload as Record<string, unknown> };
  } catch {
    return null;
  }
}

/** Extract the bearer token from a request, or `null` if absent. */
export function extractBearer(req: Request): string | null {
  const auth = req.headers.get('Authorization') || req.headers.get('authorization');
  if (!auth) return null;
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}
