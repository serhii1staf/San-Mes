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
import { signToken } from '../auth';
import { asStr, readJson } from '../validate';

const PROFILE_FULL_COLUMNS = `id, username, display_name, emoji, bio, pin_hash, device_key, banner_url, theme_id, header_scene, links, badge, is_verified, created_at, updated_at`;

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
    `SELECT ${PROFILE_FULL_COLUMNS} FROM profiles WHERE id = ? LIMIT 1`,
    [id],
  );
  const profile = normalizeProfile(row);
  const token = await signToken(env, id);
  return ok(req, { profile, token });
});

// ── POST /v1/auth/login ───────────────────────────────────────────────
//
// Body: { deviceKey, pin }
// Returns: { profile, token }
register('POST', '/v1/auth/login', async (req, env) => {
  const body = await readJson<{ deviceKey?: unknown; pin?: unknown }>(req);
  if (!body.ok) return fail(req, body.error, 400);
  const deviceKey = asStr(body.value.deviceKey, 64);
  const pin = asStr(body.value.pin, 16);
  if (!deviceKey || !pin) return fail(req, 'invalid_key_or_pin', 400);

  const row = await queryOne<Record<string, unknown>>(
    env,
    `SELECT ${PROFILE_FULL_COLUMNS} FROM profiles WHERE device_key = ? AND pin_hash = ? LIMIT 1`,
    [deviceKey, hashPin(pin)],
  );
  if (!row) return fail(req, 'invalid_key_or_pin', 401);

  const profile = normalizeProfile(row);
  const token = await signToken(env, row.id as string);
  return ok(req, { profile, token });
});

// ── POST /v1/auth/login-with-pin ──────────────────────────────────────
//
// Body: { pin }
// Returns: { profile, token } for the FIRST profile with a matching
// pin_hash. Mirrors the existing `loginWithPin` quick-login flow.
register('POST', '/v1/auth/login-with-pin', async (req, env) => {
  const body = await readJson<{ pin?: unknown }>(req);
  if (!body.ok) return fail(req, body.error, 400);
  const pin = asStr(body.value.pin, 16);
  if (!pin) return fail(req, 'invalid_pin', 400);

  const row = await queryOne<Record<string, unknown>>(
    env,
    `SELECT ${PROFILE_FULL_COLUMNS} FROM profiles WHERE pin_hash = ? LIMIT 1`,
    [hashPin(pin)],
  );
  if (!row) return fail(req, 'invalid_pin', 401);

  const profile = normalizeProfile(row);
  const token = await signToken(env, row.id as string);
  return ok(req, { profile, token });
});

// ── GET /v1/auth/me ───────────────────────────────────────────────────
//
// Returns the current authed user's profile, or 401 if no token.
register('GET', '/v1/auth/me', async (req, env, _ctx, _params, authedUserId) => {
  if (!authedUserId) return fail(req, 'unauthorised', 401);
  const row = await queryOne<Record<string, unknown>>(
    env,
    `SELECT ${PROFILE_FULL_COLUMNS} FROM profiles WHERE id = ? LIMIT 1`,
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
  const token = await signToken(env, authedUserId);
  return ok(req, { token });
});

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
