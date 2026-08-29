// Devices — a real list of the installs signed into this account.
//
// POST   /v1/devices/heartbeat  — Body: { installId, platform?, model?, osVersion?, appVersion? }
//                                 → { ok: true } | { revoked: true }
//                                 Upsert this install for the caller, bumping `last_seen_at`.
// GET    /v1/devices            — → the caller's devices, most recently active first.
// POST   /v1/devices/revoke     — Body: { installId } → remove a device's access.
//
// ── WHY THIS REPLACES THE push_tokens-BACKED LIST ───────────────────────────
//
// The first Devices screen listed `push_tokens`, because that was the only per-device record the
// backend kept. Reported: two people share the account and the screen showed one device. A device
// only reaches `push_tokens` if it granted notification permission and has not signed out since, so
// the list was structurally incomplete for the one job it has.
//
// Signing in is the event the feature is about, so that is what gets recorded. See migration 0007
// for the full reasoning, including why `install_id` is an opaque per-install token rather than
// anything derived from the device, and why `profiles.device_key` could not be used (it is the shared
// per-ACCOUNT login secret, identical on both devices in the reported case).

import { fail, ok } from '../http';
import { register } from '../router';
import { exec, query, queryOne } from '../db';
import { readJson } from '../validate';

/** Cap on rows returned. An account holds a handful; this bounds a pathological case. */
const DEVICES_PAGE_LIMIT = 50;

/**
 * Validate a client-supplied install id.
 *
 * Required to look like a UUID. Not because the format carries meaning, but because it is the one
 * cheap way to reject a caller trying to use this column for something it is not — a username, an
 * email, a device serial. The client generates it with `crypto.randomUUID()`; anything else is a
 * caller that should be told no rather than silently accommodated.
 */
function parseInstallId(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s) ? s : null;
}

/** Trim a descriptive field to something a settings row can render, or null. */
function label(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().slice(0, max);
  return s.length > 0 ? s : null;
}

// ── POST /v1/devices/heartbeat ─────────────────────────────────────────
//
// Called by the client right after sign-in and on each return to the foreground (throttled
// client-side). Two jobs in one round trip: keep the row fresh, and find out whether this install has
// been revoked.
//
// The revocation answer is why this is a POST that returns something rather than a fire-and-forget
// ping. Token verification in this Worker is pure HMAC with no database access, so nothing on the
// per-request path can know about a tombstone without adding a D1 read to every single call. The
// heartbeat already talks to the database, so it is the natural place to deliver the news — and the
// client signs itself out when it hears it.
//
// A revoked install is NOT re-created here. The `revoked_at IS NULL` guard on the upsert's UPDATE
// branch is what makes the tombstone stick; without it the revoked device's next heartbeat would
// quietly restore its own access, which is the failure mode that makes a "disconnect" button a lie.
register('POST', '/v1/devices/heartbeat', async (req, env, _ctx, _params, authedUserId) => {
  if (!authedUserId) return fail(req, 'unauthorised', 401);
  const body = await readJson<{
    installId?: unknown; platform?: unknown; model?: unknown; osVersion?: unknown; appVersion?: unknown;
  }>(req);
  if (!body.ok) return fail(req, body.error, 400);
  const installId = parseInstallId(body.value.installId);
  if (!installId) return fail(req, 'invalid installId', 400);

  const existing = await queryOne<{ revoked_at: string | null }>(
    env,
    `SELECT revoked_at FROM devices WHERE install_id = ? AND user_id = ? LIMIT 1`,
    [installId, authedUserId],
  );
  // Told plainly, and checked BEFORE the write so a revoked install cannot refresh its own
  // `last_seen_at` and reappear at the top of the owner's list.
  if (existing?.revoked_at) return ok(req, { revoked: true });

  const now = new Date().toISOString();
  await exec(
    env,
    `INSERT INTO devices (install_id, user_id, platform, model, os_version, app_version, first_seen_at, last_seen_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(install_id, user_id) DO UPDATE SET
            last_seen_at = excluded.last_seen_at,
            -- Descriptive fields are refreshed because they legitimately change: an OS update, an app
            -- update. first_seen_at is NOT, because "on my account since" is the useful fact and
            -- overwriting it would reset the only history the row carries.
            platform     = excluded.platform,
            model        = excluded.model,
            os_version   = excluded.os_version,
            app_version  = excluded.app_version
        WHERE devices.revoked_at IS NULL`,
    [
      installId,
      authedUserId,
      label(body.value.platform, 16),
      label(body.value.model, 64),
      label(body.value.osVersion, 32),
      label(body.value.appVersion, 32),
      now,
      now,
    ],
  );
  return ok(req, { ok: true });
});

// ── GET /v1/devices ────────────────────────────────────────────────────
//
// Revoked rows are excluded: the tombstone exists to enforce revocation, not to keep a record the
// owner has to look at. Once removed, a device is gone from the list.
register('GET', '/v1/devices', async (req, env, _ctx, _params, authedUserId) => {
  if (!authedUserId) return fail(req, 'unauthorised', 401);
  const rows = await query<{
    install_id: string;
    platform: string | null;
    model: string | null;
    os_version: string | null;
    app_version: string | null;
    first_seen_at: string;
    last_seen_at: string;
  }>(
    env,
    // Served by idx_devices_user_seen (user_id, last_seen_at DESC).
    `SELECT install_id, platform, model, os_version, app_version, first_seen_at, last_seen_at
       FROM devices
      WHERE user_id = ?
        AND revoked_at IS NULL
   ORDER BY last_seen_at DESC
      LIMIT ?`,
    [authedUserId, DEVICES_PAGE_LIMIT],
  );
  return ok(req, rows);
});

// ── POST /v1/devices/revoke ────────────────────────────────────────────
//
// Body: { installId } → { revoked: true }
//
// Scoped by `user_id`, so this can only ever affect a row on the caller's own account — a caller
// cannot revoke someone else's device even knowing its install id, and cannot revoke the same
// install's row on a different account.
//
// Idempotent: revoking twice is a no-op, and revoking an unknown id succeeds without saying whether
// it existed. That last part is deliberate — a 404 here would turn this endpoint into an oracle for
// "is this install id on this account", which is information the caller has no need for.
register('POST', '/v1/devices/revoke', async (req, env, _ctx, _params, authedUserId) => {
  if (!authedUserId) return fail(req, 'unauthorised', 401);
  const body = await readJson<{ installId?: unknown }>(req);
  if (!body.ok) return fail(req, body.error, 400);
  const installId = parseInstallId(body.value.installId);
  if (!installId) return fail(req, 'invalid installId', 400);

  const now = new Date().toISOString();
  await exec(
    env,
    `UPDATE devices SET revoked_at = ?
      WHERE install_id = ? AND user_id = ? AND revoked_at IS NULL`,
    [now, installId, authedUserId],
  );
  // Notifications stop too, and this is the part that is immediate rather than
  // heartbeat-dependent: the push token row is what the fan-out reads, so deleting it means the
  // revoked device stops receiving messages the moment this call lands, whether or not it ever
  // heartbeats again.
  await exec(
    env,
    `DELETE FROM push_tokens WHERE install_id = ? AND user_id = ?`,
    [installId, authedUserId],
  );
  return ok(req, { revoked: true });
});
