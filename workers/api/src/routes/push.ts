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
  const body = await readJson<{ token?: unknown; platform?: unknown; installId?: unknown }>(req);
  if (!body.ok) return fail(req, body.error, 400);
  const token = typeof body.value.token === 'string' ? body.value.token.slice(0, 256) : '';
  if (!token || token.indexOf('ExponentPushToken') !== 0) return fail(req, 'invalid token', 400);
  const platform = typeof body.value.platform === 'string' ? body.value.platform.slice(0, 16) : '';
  // Which install this token belongs to (migration 0007). Optional and unvalidated beyond a length
  // cap: an older client sends nothing and keeps working exactly as before, and the only thing this
  // column does is let `POST /v1/devices/revoke` delete the right row. A wrong value costs the
  // revoking user one notification cut that misses; it cannot expose or destroy anything, because
  // every statement touching it is also scoped by `user_id`.
  const installId = typeof body.value.installId === 'string' ? body.value.installId.slice(0, 64) : null;
  const now = new Date().toISOString();
  await exec(
    env,
    `INSERT INTO push_tokens (token, user_id, platform, install_id, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(token) DO UPDATE SET
            user_id    = excluded.user_id,
            platform   = excluded.platform,
            -- COALESCE so a client that does not send an install id cannot BLANK one that a newer
            -- build already recorded. Re-registration happens whenever the Expo token rotates, and
            -- losing the link would silently break revocation for that device.
            install_id = COALESCE(excluded.install_id, push_tokens.install_id)`,
    [token, authedUserId, platform, installId, now],
  );
  return ok(req, { registered: true });
});

// ── GET /v1/push/devices — REMOVED ────────────────────────────────────
//
// It listed `push_tokens` and backed the first Devices screen. Reported: two people share the account
// and the screen showed one device. A device only reaches `push_tokens` if it granted notification
// permission and has not signed out since, so the list was structurally incomplete for the one job it
// has — and a careful subtitle explaining that does not make the screen do its job.
//
// Replaced by `GET /v1/devices` in `routes/devices.ts`, backed by the `devices` table (migration
// 0007), which records a row at SIGN-IN. That is the event the feature is about.
//
// `push_tokens` keeps its narrow purpose: which tokens to fan a notification out to. It gained an
// `install_id` column so revoking a device can also cut its notifications immediately.

register('POST', '/v1/push/unregister', async (req, env, _ctx, _params, authedUserId) => {
  if (!authedUserId) return fail(req, 'unauthorised', 401);
  const body = await readJson<{ token?: unknown }>(req);
  if (!body.ok) return fail(req, body.error, 400);
  const token = typeof body.value.token === 'string' ? body.value.token.slice(0, 256) : '';
  if (token) await exec(env, `DELETE FROM push_tokens WHERE token = ? AND user_id = ?`, [token, authedUserId]);
  return ok(req, { unregistered: true });
});
