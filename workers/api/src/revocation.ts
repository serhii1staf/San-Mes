// Is this install still allowed to use this account?
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────
//
// "Disconnect this device" has to actually sign the device out. Until now it could not: token
// verification is pure HMAC with no database access, tokens last 30 days, and nothing in the token said
// which install presented it. The best available enforcement was the device heartbeat telling a
// revoked install to log itself out — which works for the normal app but is cooperative, and a
// cooperative sign-out is not a sign-out.
//
// The token now carries an `install` claim (see `auth.ts`). Because it is inside the signature the
// client cannot forge or strip it, so the request path can check it.
//
// ── WHY THIS IS NOT A DATABASE READ PER REQUEST ────────────────────────────
//
// It would be, done naively, and that was the reason for not doing it: every authed call in the app
// would gain a D1 read purely to ask a question whose answer is "still fine" essentially always.
//
// Revocations are rare and their effect only needs to be prompt, not instantaneous. So the answer is
// cached per isolate for `TTL_MS`, which turns "one read per request" into "one read per install per
// minute per isolate". Workers reuse isolates across requests, so in practice a busy account pays a
// handful of reads an hour instead of one per tap.
//
// The bound this buys is stated plainly in the UI: a disconnected device stops receiving notifications
// immediately (that half is a row deletion, not a check) and loses access within about a minute.
//
// ── WHAT IS DELIBERATELY NOT CACHED ────────────────────────────────────────
//
// A REVOKED answer is cached for the same TTL as an allowed one, which is safe in the direction that
// matters: it can only keep a device locked out slightly longer than necessary, and re-signing in mints
// a token with a fresh install row. Caching in the other direction — remembering "allowed" for hours —
// is what would make revocation feel broken, which is why the TTL is a minute rather than an hour.
//
// Nothing here throws. A failed lookup returns "allowed": a transient D1 error must not log the whole
// user base out, and the heartbeat path still catches a revoked install on its next foreground.

import { Env, queryOne } from './db';

/** How long an answer is trusted inside one isolate. */
const TTL_MS = 60_000;

/**
 * Ceiling on distinct installs remembered per isolate. An isolate serves many accounts, so this is not
 * "devices on one account". Overflow clears the whole map rather than evicting cleverly — the cost of
 * being wrong is a few extra reads, and a simple rule cannot leak.
 */
const MAX_ENTRIES = 500;

interface Entry {
  revoked: boolean;
  at: number;
}

const cache = new Map<string, Entry>();

/**
 * `false` when this install has been disconnected from this account and must be refused.
 *
 * Returns `true` — allowed — for a token with no install claim. Those were minted before the claim
 * existed and cannot be attributed to a device, so there is nothing to check; they expire within the
 * 30-day token lifetime. Every token issued now carries the claim.
 */
export async function isInstallAllowed(
  env: Env,
  userId: string,
  installId: string | null,
): Promise<boolean> {
  if (!installId) return true;
  const key = `${installId}|${userId}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL_MS) return !hit.revoked;

  let revoked = false;
  try {
    // PK lookup on `(install_id, user_id)`. Selecting `revoked_at` rather than testing it in SQL so a
    // MISSING row is distinguishable from a present-but-not-revoked one — see below for why that
    // distinction has to fall the way it does.
    const row = await queryOne<{ revoked_at: string | null }>(
      env,
      `SELECT revoked_at FROM devices WHERE install_id = ? AND user_id = ? LIMIT 1`,
      [installId, userId],
    );
    // NO ROW MEANS ALLOWED, and this is the important call. A device whose heartbeat has not landed
    // yet — the window between signing in and the first heartbeat, or any install that predates the
    // `devices` table — has no row, and refusing it would lock legitimate users out of the app.
    // Revocation is a positive fact recorded as a tombstone (`devices.revoked_at`, never a DELETE,
    // precisely so this check has something to find), so only a tombstone denies.
    revoked = !!row?.revoked_at;
  } catch {
    // Treat an unavailable database as allowed. The alternative is logging everyone out during a
    // transient D1 error, which is a far worse failure than a revoked device surviving another minute.
    revoked = false;
  }

  if (cache.size >= MAX_ENTRIES) cache.clear();
  cache.set(key, { revoked, at: now });
  return !revoked;
}

/** Drop a cached answer immediately — called right after a revoke so the same isolate stops trusting it. */
export function forgetInstallDecision(userId: string, installId: string): void {
  cache.delete(`${installId}|${userId}`);
}

/** Test seam. */
export function __resetRevocationCacheForTests(): void {
  cache.clear();
}
