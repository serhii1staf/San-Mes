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
import { exec } from '../db';
import { readJson } from '../validate';

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

register('POST', '/v1/push/unregister', async (req, env, _ctx, _params, authedUserId) => {
  if (!authedUserId) return fail(req, 'unauthorised', 401);
  const body = await readJson<{ token?: unknown }>(req);
  if (!body.ok) return fail(req, body.error, 400);
  const token = typeof body.value.token === 'string' ? body.value.token.slice(0, 256) : '';
  if (token) await exec(env, `DELETE FROM push_tokens WHERE token = ? AND user_id = ?`, [token, authedUserId]);
  return ok(req, { unregistered: true });
});
