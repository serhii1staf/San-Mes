// Push-token registration endpoints.
//
// POST /v1/push/register    — Body: { token, platform } → upsert the caller's
//                             Expo push token (rebinds the token to this user
//                             if it moved devices/accounts).
// POST /v1/push/unregister  — Body: { token } → drop the token (logout).
//
// Tokens are the Expo push token string ("ExponentPushToken[...]"). One row
// per device token; `token` is the primary key so a device that switches
// accounts simply rebinds to the new user_id.

import { fail, ok } from '../http';
import { register } from '../router';
import { exec, query } from '../db';
import { readJson } from '../validate';

/**
 * Cap on how many device rows one list call returns.
 *
 * `push_tokens` grows by one row per (device, account) pair and shrinks on logout, so a real account
 * holds a handful. The cap exists so a pathological row count cannot turn a settings screen into an
 * unbounded response, and newest-first ordering means what falls off is the least recently registered.
 */
const DEVICES_PAGE_LIMIT = 50;

register('POST', '/v1/push/register', async (req, env, _ctx, _params, authedUserId) => {
  if (!authedUserId) return fail(req, 'unauthorised', 401);
  const body = await readJson<{ token?: unknown; platform?: unknown }>(req);
  if (!body.ok) return fail(req, body.error, 400);
  const token = typeof body.value.token === 'string' ? body.value.token.slice(0, 256) : '';
  if (!token || token.indexOf('ExponentPushToken') !== 0) return fail(req, 'invalid token', 400);
  const platform = typeof body.value.platform === 'string' ? body.value.platform.slice(0, 16) : '';
  const now = new Date().toISOString();
  await exec(
    env,
    `INSERT INTO push_tokens (token, user_id, platform, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(token) DO UPDATE SET user_id = excluded.user_id, platform = excluded.platform`,
    [token, authedUserId, platform, now],
  );
  return ok(req, { registered: true });
});

// ── GET /v1/push/devices ──────────────────────────────────────────────
//
// The caller's own registered devices, newest first. Backs the Devices screen in Settings.
//
// WHAT THIS LIST IS, AND WHAT IT IS NOT
//
// It is every device that has REGISTERED FOR NOTIFICATIONS on this account. It is NOT "every device
// that ever signed in", which is what a Telegram-style sessions screen shows, and the UI must not
// claim otherwise. Nothing in this backend records a login: there is no sessions table, and the auth
// token is a stateless JWT with nothing to enumerate. `push_tokens` is the only per-install record
// that exists.
//
// So the honest gap: a device where the user declined the notification permission, or an iOS
// simulator, never registers and therefore never appears — while a device that granted it and was
// later signed out of does not appear either, because logout deletes the row. The screen's subtitle
// says this in both languages rather than implying a completeness it cannot have.
//
// Building the real thing would mean recording a row per sign-in with whatever identifies the device.
// That is new device-data collection, it needs consent under the compliance rules, and deriving a
// stable per-device identifier is explicitly forbidden — so it is deliberately not what this does.
// This endpoint exposes data we ALREADY hold, to the person it is about, with a delete control. That
// direction is a transparency improvement, not a new collection.
//
// ON RETURNING THE RAW TOKEN
//
// The token is the primary key, so it is what `POST /v1/push/unregister` needs to revoke a row — and
// reusing that existing, already-scoped endpoint is better than inventing a second delete path with a
// second authorisation check to get wrong.
//
// It is not an escalation. A caller reaching this handler is already authenticated AS the owner of
// these rows; someone in that position can read every message in the account, so learning the account's
// other push tokens adds nothing they could not already do far worse with. The UI still never renders
// the full value — it shows platform, date, and a short suffix — so the string does not end up on a
// screen or in a screenshot.
register('GET', '/v1/push/devices', async (req, env, _ctx, _params, authedUserId) => {
  if (!authedUserId) return fail(req, 'unauthorised', 401);
  // `idx_push_tokens_user` covers the WHERE; the ORDER BY is over a handful of rows.
  //
  // `created_at` is nullable and the register upsert's DO UPDATE deliberately does NOT touch it, so a
  // re-registering device keeps its ORIGINAL date — which is the useful one ("since when has this
  // device been on my account") rather than "when did the token last refresh". NULLs sort last under
  // DESC in SQLite, which puts undated legacy rows at the bottom where they belong.
  const rows = await query<{ token: string; platform: string | null; created_at: string | null }>(
    env,
    `SELECT token, platform, created_at
       FROM push_tokens
      WHERE user_id = ?
   ORDER BY created_at DESC
      LIMIT ?`,
    [authedUserId, DEVICES_PAGE_LIMIT],
  );
  return ok(req, rows);
});

register('POST', '/v1/push/unregister', async (req, env, _ctx, _params, authedUserId) => {
  if (!authedUserId) return fail(req, 'unauthorised', 401);
  const body = await readJson<{ token?: unknown }>(req);
  if (!body.ok) return fail(req, body.error, 400);
  const token = typeof body.value.token === 'string' ? body.value.token.slice(0, 256) : '';
  if (token) await exec(env, `DELETE FROM push_tokens WHERE token = ? AND user_id = ?`, [token, authedUserId]);
  return ok(req, { unregistered: true });
});
