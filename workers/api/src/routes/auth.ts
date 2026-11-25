// Auth endpoints — Phase 6 of the D1 migration.
//
// The Worker is now the auth authority. Supabase Auth no longer runs
// on the hot path; clients call these endpoints to register, log in,
// and refresh, and the Worker hands back its own HS256 JWTs that all
// other Worker endpoints verify via `auth.ts:verifyToken`.
//
// The PIN hash is computed BY the client today (`hashPin` in
// `src/lib/supabase.ts`) — we mirror the same algorithm here on the
// server so the on-the-wire shape doesn't change. The hash is NOT a
// strong password digest (it's a simple djb2-style 32-bit accumulator
// with a salt); that's acceptable because:
//   - the app is single-user (solo dev)
//   - PINs are only 4 digits, so a real bcrypt would still be brute-
//     forceable in milliseconds
//   - the JWT is the actual auth token; the PIN only exists to scope a
//     local device-key lookup
// If we ever open the app to multiple users we'll move to argon2id +
// rate-limiting.

import { fail, ok } from '../http';
import { register } from '../router';
import { exec, normalizeProfile, query, queryOne } from '../db';
import { claimsOf, signToken } from '../auth';
import { forgetInstallDecision } from '../revocation';
import { asStr, readJson } from '../validate';

// Projection returned by the auth endpoints.
//
// SECURITY: `device_key` IS included — the client stores it to offer the account in
// the switcher, and every caller here has either just typed it or just had it
// generated for them, so it is not a disclosure. `pin_hash` is NOT included and
// must never be: it is a derivative of a 4-digit PIN under a 32-bit accumulator,
// so handing it out is equivalent to handing out the PIN. It is still used as a
// WHERE predicate below — comparing against it server-side is exactly what it is
// for — but it never travels in a response.
// ── `header_scene` IS NOT IN THIS LIST ON PURPOSE ───────────────────────────
//
// The live D1 database does not have that column. `workers/migrations/0003_profiles_header_scene.sql`
// adds it and has never been applied, so every query naming it fails outright:
//
//   D1_ERROR: no such column: header_scene at offset 81: SQLITE_ERROR
//
// which is a hard failure of LOGIN and of every profile read — not a degraded feature. The
// code was written against a schema that only ever existed in `schema.sql`, and it stayed
// invisible because the Worker had not been redeployed since. Deploying current `main` shipped
// it and broke the app.
//
// So the column is dropped from the read path until the migration is actually applied. Nothing
// is lost that ever worked: with no column in the database, header decorations have never been
// readable in production.
//
// TO RESTORE: apply the migration, then add `header_scene` back here and in
// `PROFILE_PUBLIC_COLUMNS` (workers/api/src/routes/profiles.ts).
//
//   cd workers/api
//   npx wrangler d1 execute san-mes --remote --file=../migrations/0003_profiles_header_scene.sql
//
// That needs an API token with Account → D1 → Edit. Verify with
// `SELECT name FROM pragma_table_info('profiles') WHERE name='header_scene'` before re-adding —
// re-adding it without the column reintroduces exactly this outage.
// `screenshots_disabled` is the owner's own setting; `/me` has to return it or the app resets the
// toggle to off on every launch. See `PROFILE_PUBLIC_COLUMNS` in routes/profiles.ts.
const PROFILE_AUTH_COLUMNS = `id, username, display_name, emoji, bio, device_key, banner_url, theme_id, links, badge, is_verified, created_at, updated_at, screenshots_disabled`;

// Mirror of `hashPin` in `src/lib/supabase.ts`. Keeps the on-the-wire
// PIN hash compatible with any client build that still computes it
// locally, and lets us keep the same shape if the client ever stops
// hashing client-side.
function hashPin(pin: string): string {
  let hash = 0;
  const str = pin + 'san_salt_2024';
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

const USERNAME_RE = /^[a-z0-9_]{2,32}$/;

// ── Login lockout (see "THE PIN CANNOT BE WALKED THROUGH" in the login route) ─────────────────
const FAILURE_WINDOW_S = 15 * 60;

async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function readLock(env: import('../db').Env, keyHash: string): Promise<{ failures: number; window_start: number; locked_until: number } | null> {
  try {
    return await queryOne<{ failures: number; window_start: number; locked_until: number }>(
      env,
      `SELECT failures, window_start, locked_until FROM auth_failures WHERE key_hash = ? LIMIT 1`,
      [keyHash],
    );
  } catch {
    return null;
  }
}

function lockSeconds(failures: number): number {
  if (failures >= 20) return 24 * 60 * 60;
  if (failures >= 10) return 60 * 60;
  if (failures >= 5) return 15 * 60;
  return 0;
}

async function noteFailure(env: import('../db').Env, keyHash: string, nowS: number): Promise<void> {
  try {
    const prev = await readLock(env, keyHash);
    // A quiet quarter of an hour starts the count again, unless the key has already been locked: then
    // the count is kept, so the locks escalate rather than restart, until a quiet day has passed.
    const since = prev ? nowS - prev.window_start : 0;
    const fresh = !prev || (prev.locked_until <= nowS && (since > 24 * 60 * 60 || (since > FAILURE_WINDOW_S && prev.failures < 5)));
    const failures = fresh ? 1 : prev!.failures + 1;
    const windowStart = fresh ? nowS : prev!.window_start;
    const lockFor = lockSeconds(failures);
    const lockedUntil = lockFor > 0 ? nowS + lockFor : 0;
    await exec(
      env,
      `INSERT INTO auth_failures (key_hash, failures, window_start, locked_until) VALUES (?, ?, ?, ?)
         ON CONFLICT(key_hash) DO UPDATE SET failures = excluded.failures,
                                             window_start = excluded.window_start,
                                             locked_until = excluded.locked_until`,
      [keyHash, failures, windowStart, lockedUntil],
    );
  } catch {}
}

async function clearFailures(env: import('../db').Env, keyHash: string): Promise<void> {
  try {
    await exec(env, `DELETE FROM auth_failures WHERE key_hash = ?`, [keyHash]);
  } catch {}
}

// ── POST /v1/auth/register ────────────────────────────────────────────
//
// Body: { username, displayName, emoji, pin, deviceKey }
// Returns: { profile, token }
register('POST', '/v1/auth/register', async (req, env) => {
  const body = await readJson<{
    username?: unknown;
    displayName?: unknown;
    emoji?: unknown;
    pin?: unknown;
    deviceKey?: unknown;
    installId?: unknown;
  }>(req);
  if (!body.ok) return fail(req, body.error, 400);

  const username = (asStr(body.value.username, 32) || '').toLowerCase();
  const displayName = asStr(body.value.displayName, 64);
  const emoji = asStr(body.value.emoji, 16);
  const pin = asStr(body.value.pin, 16);
  const deviceKey = asStr(body.value.deviceKey, 64);

  if (!username || !USERNAME_RE.test(username)) return fail(req, 'invalid username', 400);
  if (!displayName) return fail(req, 'invalid display name', 400);
  if (!emoji) return fail(req, 'invalid emoji', 400);
  if (!pin || pin.length < 4) return fail(req, 'invalid pin', 400);
  if (!deviceKey) return fail(req, 'invalid device key', 400);

  // Username uniqueness check first so we return the canonical error
  // string the client already branches on (`username_taken`).
  const existing = await queryOne<{ id: string }>(
    env,
    `SELECT id FROM profiles WHERE username = ? LIMIT 1`,
    [username],
  );
  if (existing) return fail(req, 'username_taken', 400);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const pinHash = hashPin(pin);

  await exec(
    env,
    `INSERT INTO profiles (id, username, display_name, emoji, bio, pin_hash, device_key, is_verified, created_at, updated_at)
     VALUES (?, ?, ?, ?, '', ?, ?, 0, ?, ?)`,
    [id, username, displayName, emoji, pinHash, deviceKey, now, now],
  );

  const row = await queryOne<Record<string, unknown>>(
    env,
    `SELECT ${PROFILE_AUTH_COLUMNS} FROM profiles WHERE id = ? LIMIT 1`,
    [id],
  );
  const profile = normalizeProfile(row);
  // Bind the token to the install that registered, so "disconnect this device" can enforce itself on
  // the request path rather than depending on that device cooperating. See `revocation.ts`.
  const registeredInstall = asStr(body.value.installId, 64);
  await noteInstall(env, id, registeredInstall);
  const token = await signToken(env, id, registeredInstall);
  return ok(req, { profile, token });
});

// ── POST /v1/auth/login ───────────────────────────────────────────────
//
// Body: { deviceKey, pin }
// Returns: { profile, token }
register('POST', '/v1/auth/login', async (req, env) => {
  const body = await readJson<{ deviceKey?: unknown; pin?: unknown; installId?: unknown }>(req);
  if (!body.ok) return fail(req, body.error, 400);
  const deviceKey = asStr(body.value.deviceKey, 64);
  const pin = asStr(body.value.pin, 16);
  if (!deviceKey || !pin) return fail(req, 'invalid_key_or_pin', 400);

  // ── THE PIN CANNOT BE WALKED THROUGH (Nov 2026) ──────────────────────────────────────────────
  //
  // The device key is shown to its owner (Settings) and typed by whoever signs in on a second phone,
  // and the PIN can be four digits. With no limit, anyone who had seen a device key could try
  // 0000-9999 in a couple of minutes and own the account for good. Failures are now counted per device
  // key (as a SHA-256, never the key): after 5 in a quarter of an hour the key is locked for 15
  // minutes, after 10 for an hour, after 20 for a day, and a successful sign-in clears the count. A
  // locked key answers 429 'too_many_attempts' before the PIN is even compared. Per address, the
  // `RL_AUTH` limit (guards.ts) caps the attempts too. Best-effort: without the table (migration 0009
  // not applied) sign-in works as before.
  const keyHash = await sha256Hex(deviceKey);
  const nowS = Math.floor(Date.now() / 1000);
  const lock = await readLock(env, keyHash);
  if (lock && lock.locked_until > nowS) {
    const res = fail(req, 'too_many_attempts', 429);
    res.headers.set('Retry-After', String(Math.max(1, lock.locked_until - nowS)));
    return res;
  }

  const row = await queryOne<Record<string, unknown>>(
    env,
    `SELECT ${PROFILE_AUTH_COLUMNS} FROM profiles WHERE device_key = ? AND pin_hash = ? LIMIT 1`,
    [deviceKey, hashPin(pin)],
  );
  if (!row) {
    await noteFailure(env, keyHash, nowS);
    return fail(req, 'invalid_key_or_pin', 401);
  }
  await clearFailures(env, keyHash);

  const profile = normalizeProfile(row);
  // ── SIGNING IN CLEARS A PREVIOUS REVOCATION FOR THIS INSTALL ──────────────
  //
  // Without this, "disconnect" would be permanent for that device: the tombstone would still be there,
  // the new token would carry the same install id, and `isInstallAllowed` would refuse it — so someone
  // who removed their own phone by mistake could never sign back in on it, and the confirmation copy
  // ("signing back in needs the device key and PIN") would be false.
  //
  // Presenting the device key AND the PIN is the account's own credential, so it is exactly the right
  // gate for undoing a revocation. Scoped to this install on this account, so it cannot clear anyone
  // else's.
  //
  // The cached decision is dropped too, or this isolate would keep refusing for up to a minute after a
  // successful sign-in.
  const installId = asStr(body.value.installId, 64);
  if (installId) {
    await exec(
      env,
      `UPDATE devices SET revoked_at = NULL WHERE install_id = ? AND user_id = ?`,
      [installId, row.id as string],
    );
    forgetInstallDecision(row.id as string, installId);
  }
  await noteInstall(env, row.id as string, installId);
  const token = await signToken(env, row.id as string, installId);
  return ok(req, { profile, token });
});

// ── POST /v1/auth/login-with-pin — REMOVED (security) ─────────────────
//
// This endpoint took ONLY `{ pin }`, selected the first profile whose `pin_hash`
// matched, and signed a 30-day token for it. That is a full account takeover behind
// a 4-digit secret with no second factor, no lockout and no rate limiting anywhere
// in the Worker: walking 0000–9999 (10k unthrottled requests) logs the caller in as
// whichever account matches first. The PIN hash is also a 32-bit accumulator, so
// collisions meant a WRONG pin could authenticate as a stranger's account.
//
// It was dead weight as well as dangerous — `loginWithPin` was exported from
// `src/services/authClient.ts` and re-exported from `src/lib/supabase.ts`, but no
// screen ever called it. Both client wrappers were removed alongside this handler.
//
// `POST /v1/auth/login` remains: it requires the device key AND the PIN, so the
// secret being brute-forced is the 32+ character device key, not four digits.

// ── GET /v1/auth/me ───────────────────────────────────────────────────
//
// Returns the current authed user's profile, or 401 if no token.
register('GET', '/v1/auth/me', async (req, env, _ctx, _params, authedUserId) => {
  if (!authedUserId) return fail(req, 'unauthorised', 401);
  const row = await queryOne<Record<string, unknown>>(
    env,
    `SELECT ${PROFILE_AUTH_COLUMNS} FROM profiles WHERE id = ? LIMIT 1`,
    [authedUserId],
  );
  if (!row) return fail(req, 'unauthorised', 401);
  return ok(req, normalizeProfile(row));
});

// ── POST /v1/auth/refresh ─────────────────────────────────────────────
//
// Re-issues a fresh JWT for the current authed user. Lets long-running
// sessions stay logged in without re-asking for the PIN.
register('POST', '/v1/auth/refresh', async (req, env, _ctx, _params, authedUserId) => {
  if (!authedUserId) return fail(req, 'unauthorised', 401);
  // ── A DELETED ACCOUNT'S TOKEN IS NOT RENEWED (Nov 2026) ───────────────────────────────────────
  // Nothing checked that the profile still existed, so a token outlived `DELETE /v1/auth/me` and kept
  // refreshing itself, writing posts and messages under an id that no longer has a profile.
  const exists = await queryOne<{ x: number }>(env, `SELECT 1 AS x FROM profiles WHERE id = ? LIMIT 1`, [authedUserId]);
  if (!exists) return fail(req, 'unauthorised', 401);
  // ── A REFRESH KEEPS THE TOKEN'S OWN INSTALL (Nov 2026) ────────────────────────────────────────
  //
  // The install claim has to survive a refresh, or revocation has a hole: a revoked device is
  // refused, and a refresh minting an unattributed token would give it thirty more days. It used to be
  // read from the request body, on the reasoning that only an old client can hold a token without the
  // claim. Any HTTP client can leave the body empty, though, and so turn a revocable token into one
  // that can never be revoked, refreshable for ever. The presented token's own claim now wins; the
  // body is read only for a token minted before the claim existed. Current builds send the same id in
  // both places, so nothing changes for them.
  const claims = claimsOf(req);
  let installId = claims?.installId ?? null;
  if (!installId) {
    const body = await readJson<{ installId?: unknown }>(req);
    installId = body.ok ? asStr(body.value.installId, 64) : null;
  }
  await noteInstall(env, authedUserId, installId);
  const token = await signToken(env, authedUserId, installId);
  return ok(req, { token });
});

/**
 * List the install a token is being issued to on the account's devices, if it is not there yet, so
 * that every install holding a token can be seen and disconnected in Settings → Devices. The heartbeat
 * fills in its description later. Best-effort: the table may not exist on an old database.
 */
async function noteInstall(env: import('../db').Env, userId: string, installId: string | null): Promise<void> {
  const id = (installId || '').trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) return;
  const now = new Date().toISOString();
  try {
    await exec(
      env,
      `INSERT INTO devices (install_id, user_id, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(install_id, user_id) DO NOTHING`,
      [id, userId, now, now],
    );
  } catch {}
}

// ── DELETE /v1/auth/me ────────────────────────────────────────────────
//
// Deletes the current authed user's account + all owned data. Mirrors
// `deleteAccount` in `src/lib/supabase.ts`. Atomic via D1 batch.
register('DELETE', '/v1/auth/me', async (req, env, _ctx, _params, authedUserId) => {
  if (!authedUserId) return fail(req, 'unauthorised', 401);

  // Find the user's posts so we can also clean reposts referencing them.
  const ownPosts = await query<{ id: string }>(
    env,
    `SELECT id FROM posts WHERE author_id = ?`,
    [authedUserId],
  );
  const postIds = ownPosts.map((p) => p.id);

  // Find the user's conversations to scrub the transcripts.
  const myConvs = await query<{ conversation_id: string }>(
    env,
    `SELECT conversation_id FROM conversation_participants WHERE user_id = ?`,
    [authedUserId],
  );
  const convIds = myConvs.map((c) => c.conversation_id);

  // Build a single batch so the row counts can never end up partially
  // applied. D1 runs each statement in order and rolls back on failure.
  const stmts: { sql: string; params?: unknown[] }[] = [];

  // Reposts referencing each of the user's posts.
  for (const pid of postIds) {
    stmts.push({
      sql: `DELETE FROM posts WHERE content LIKE ?`,
      params: [`::repost::${pid}%`],
    });
  }

  // Likes + comments on the user's posts (those tables don't have the
  // user as author necessarily, so we wipe by post_id).
  if (postIds.length > 0) {
    // SQLite has no parameterised IN, so we expand to a comma list.
    const placeholders = postIds.map(() => '?').join(',');
    stmts.push({ sql: `DELETE FROM likes    WHERE post_id IN (${placeholders})`, params: postIds });
    stmts.push({ sql: `DELETE FROM comments WHERE post_id IN (${placeholders})`, params: postIds });
  }

  // The user's own activity rows.
  stmts.push({ sql: `DELETE FROM likes    WHERE user_id = ?`,    params: [authedUserId] });
  stmts.push({ sql: `DELETE FROM comments WHERE author_id = ?`,  params: [authedUserId] });
  stmts.push({ sql: `DELETE FROM follows  WHERE follower_id = ?`, params: [authedUserId] });
  stmts.push({ sql: `DELETE FROM follows  WHERE following_id = ?`, params: [authedUserId] });
  stmts.push({ sql: `DELETE FROM posts    WHERE author_id = ?`,  params: [authedUserId] });

  // Conversations + transcripts.
  if (convIds.length > 0) {
    const placeholders = convIds.map(() => '?').join(',');
    stmts.push({ sql: `DELETE FROM messages                  WHERE conversation_id IN (${placeholders})`, params: convIds });
    stmts.push({ sql: `DELETE FROM conversation_participants WHERE conversation_id IN (${placeholders})`, params: convIds });
    stmts.push({ sql: `DELETE FROM conversations             WHERE id              IN (${placeholders})`, params: convIds });
  }
  stmts.push({ sql: `DELETE FROM messages                  WHERE sender_id = ?`, params: [authedUserId] });
  stmts.push({ sql: `DELETE FROM conversation_participants WHERE user_id   = ?`, params: [authedUserId] });

  // Mini-apps the user created.
  stmts.push({ sql: `DELETE FROM mini_apps WHERE creator_id = ?`, params: [authedUserId] });

  // ── SATELLITE TABLES THIS USED TO LEAVE BEHIND ────────────────────────────
  //
  // Everything above was written when `profiles`, `posts`, the social graph and the transcripts were
  // the whole database. Four tables that hold rows keyed to a user were added later and never added
  // here, so "delete my account" left them all in place:
  //
  //   push_tokens    — an Expo push token belonging to the deleted account.
  //   devices        — platform / model / OS / app version and first+last seen, per install.
  //   blocked_users  — the deleted user's own block list, AND every other user's block of them.
  //   mutation_dedup — account id + opaque mutation ids.
  //
  // None of it is dramatic on its own, and none of it was visible in the app, which is exactly why it
  // survived: nothing ever read it back, so nothing ever pointed at it. It is still retained personal
  // data after an erasure request, which is the one thing account deletion is not allowed to do.
  //
  // `blocked_users` is deleted in BOTH directions on purpose. `blocker_id` is the deleted user's own
  // data; `blocked_id` is a row sitting in a STRANGER's block list still naming the deleted account.
  // Dropping the latter is also the behaviour that matches reality — the id it names no longer
  // resolves to anyone, so keeping it only preserves a dangling reference.
  //
  // `mutation_dedup` already expires on a 7-day sweep (`dedup.ts`), so this only closes that window.
  //
  // WHY THIS IS GUARDED BY A sqlite_master LOOKUP: `blocked_users` and `mutation_dedup` are created
  // LAZILY, on first use, by `routes/reports.ts` and `dedup.ts` respectively — they are not in any
  // migration. On a database where neither feature has been touched the tables do not exist, and a
  // statement naming a missing table fails the whole D1 batch, which would turn account deletion from
  // "incomplete" into "impossible". One extra read on a rare, deliberate operation buys atomicity
  // without that coupling.
  const presentTables = await query<{ name: string }>(
    env,
    `SELECT name FROM sqlite_master
      WHERE type = 'table'
        AND name IN ('push_tokens','devices','blocked_users','mutation_dedup','reports')`,
  );
  const has = new Set(presentTables.map((r) => r.name));

  if (has.has('push_tokens')) {
    stmts.push({ sql: `DELETE FROM push_tokens WHERE user_id = ?`, params: [authedUserId] });
  }
  if (has.has('devices')) {
    stmts.push({ sql: `DELETE FROM devices WHERE user_id = ?`, params: [authedUserId] });
  }
  if (has.has('blocked_users')) {
    stmts.push({ sql: `DELETE FROM blocked_users WHERE blocker_id = ?`, params: [authedUserId] });
    stmts.push({ sql: `DELETE FROM blocked_users WHERE blocked_id = ?`, params: [authedUserId] });
  }
  if (has.has('mutation_dedup')) {
    stmts.push({ sql: `DELETE FROM mutation_dedup WHERE account_id = ?`, params: [authedUserId] });
  }

  // ── `reports` IS ANONYMISED, NOT DELETED ──────────────────────────────────
  //
  // The other tables are the user's data and go. Moderation records are not, quite: App Review
  // guideline 1.2 requires the report path to work, and a queue that the reported party can empty by
  // tapping "delete account" is not a working report path — report someone, they delete, they
  // re-register, the complaint is gone. So rows are kept and the personal link is removed instead.
  //
  // Only `reporter_id` is rewritten. `target_id` is left alone: it identifies the CONTENT complained
  // about, the row it named is being deleted in this same batch, and blanking it would destroy the
  // only thing that makes the record legible to a moderator. Nothing reads `reporter_id` back — there
  // is no SELECT of it anywhere in the Worker, and the only index is (status, created_at) — so the
  // sentinel exists purely to be readable by a human looking at the table. It cannot collide with a
  // real id, which is always a UUID.
  if (has.has('reports')) {
    stmts.push({
      sql: `UPDATE reports SET reporter_id = 'deleted_account' WHERE reporter_id = ?`,
      params: [authedUserId],
    });
  }

  // Finally, the profile itself.
  stmts.push({ sql: `DELETE FROM profiles WHERE id = ?`, params: [authedUserId] });

  // D1 caps batch length at ~50 — if the user has dozens of posts this
  // could push past the limit. Run in chunks of 30 to stay well clear.
  const CHUNK = 30;
  for (let i = 0; i < stmts.length; i += CHUNK) {
    const slice = stmts.slice(i, i + CHUNK);
    const prepared = slice.map((s) => env.DB.prepare(s.sql).bind(...((s.params ?? []) as any[])));
    await env.DB.batch(prepared);
  }

  return ok(req, { deleted: true });
});
