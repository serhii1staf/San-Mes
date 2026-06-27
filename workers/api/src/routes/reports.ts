// Moderation backend — server-side content reports + user blocks.
//
// App Review Guideline 1.2 requires a *functioning* report path and a
// user-blocking path for any app with user-generated content. The
// client's "Report" buttons previously only showed a toast and "Block"
// was local-only — neither persisted anything the owner could act on.
// These endpoints persist both so abuse is detectable and reviewable.
//
// Endpoints (all require an authenticated caller):
//   POST   /v1/reports        — file a report against post/comment/profile/etc.
//   POST   /v1/blocks         — block a user (idempotent).
//   DELETE /v1/blocks/:id     — unblock a user.
//   GET    /v1/blocks         — list the caller's blocked user ids.

import { fail, ok } from '../http';
import { register } from '../router';
import { exec, query } from '../db';
import { parseUuid } from '../util';
import { readJson } from '../validate';

// ── Lazy schema bootstrap ──────────────────────────────────────────────
//
// The moderation tables aren't part of the original D1 migration, so we
// create them on demand the first time any handler in this module runs.
// `schemaEnsured` flips to `true` after the first successful pass so the
// DDL only fires once per isolate — subsequent calls no-op cheaply.
let schemaEnsured = false;

async function ensureSchema(env: import('../db').Env): Promise<void> {
  if (schemaEnsured) return;
  await exec(
    env,
    `CREATE TABLE IF NOT EXISTS reports (
       id TEXT PRIMARY KEY,
       reporter_id TEXT NOT NULL,
       target_type TEXT NOT NULL,
       target_id TEXT NOT NULL,
       category TEXT NOT NULL,
       reason TEXT,
       status TEXT NOT NULL DEFAULT 'open',
       created_at TEXT NOT NULL
     )`,
  );
  await exec(
    env,
    `CREATE TABLE IF NOT EXISTS blocked_users (
       blocker_id TEXT NOT NULL,
       blocked_id TEXT NOT NULL,
       created_at TEXT NOT NULL,
       PRIMARY KEY (blocker_id, blocked_id)
     )`,
  );
  await exec(
    env,
    `CREATE INDEX IF NOT EXISTS idx_reports_status_created
       ON reports (status, created_at)`,
  );
  schemaEnsured = true;
}

// Allowed report targets. Kept narrow so a malformed/abusive client
// can't seed the moderation queue with arbitrary target types.
const ALLOWED_TARGET_TYPES = new Set(['post', 'comment', 'profile', 'mini_app', 'message']);

// ── POST /v1/reports ───────────────────────────────────────────────────
//
// Body: { targetType, targetId, category, reason? }. Inserts an `open`
// report row. Reports are intentionally allowed to repeat — multiple
// users (or the same user) reporting the same target is signal, not an
// error — so there's no uniqueness constraint and no duplicate 500.
register('POST', '/v1/reports', async (req, env, _ctx, _params, authedUserId) => {
  if (!authedUserId) return fail(req, 'unauthorised', 401);
  await ensureSchema(env);

  const body = await readJson<{
    targetType?: unknown;
    targetId?: unknown;
    category?: unknown;
    reason?: unknown;
  }>(req);
  if (!body.ok) return fail(req, body.error, 400);

  const targetType = typeof body.value.targetType === 'string' ? body.value.targetType : '';
  if (!ALLOWED_TARGET_TYPES.has(targetType)) return fail(req, 'invalid targetType', 400);

  const targetId = typeof body.value.targetId === 'string' ? body.value.targetId.trim() : '';
  if (!targetId || targetId.length > 128) return fail(req, 'invalid targetId', 400);

  const category = typeof body.value.category === 'string' ? body.value.category.trim() : '';
  if (!category || category.length > 64) return fail(req, 'invalid category', 400);

  let reason: string | null = null;
  if (body.value.reason != null) {
    if (typeof body.value.reason !== 'string') return fail(req, 'invalid reason', 400);
    const r = body.value.reason.trim();
    if (r.length > 500) return fail(req, 'invalid reason', 400);
    reason = r || null;
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await exec(
    env,
    `INSERT INTO reports (id, reporter_id, target_type, target_id, category, reason, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`,
    [id, authedUserId, targetType, targetId, category, reason, now],
  );
  return ok(req, { reported: true });
});

// ── POST /v1/blocks ────────────────────────────────────────────────────
//
// Body: { blockedId }. Idempotent via INSERT OR IGNORE on the composite
// (blocker_id, blocked_id) primary key — blocking someone twice is a
// no-op, not an error.
register('POST', '/v1/blocks', async (req, env, _ctx, _params, authedUserId) => {
  if (!authedUserId) return fail(req, 'unauthorised', 401);
  await ensureSchema(env);

  const body = await readJson<{ blockedId?: unknown }>(req);
  if (!body.ok) return fail(req, body.error, 400);

  const blockedId = parseUuid(typeof body.value.blockedId === 'string' ? body.value.blockedId : null);
  if (!blockedId) return fail(req, 'invalid blockedId', 400);
  if (blockedId === authedUserId) return fail(req, 'cannot_block_self', 400);

  const now = new Date().toISOString();
  await exec(
    env,
    `INSERT OR IGNORE INTO blocked_users (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)`,
    [authedUserId, blockedId, now],
  );
  return ok(req, { blocked: true });
});

// ── DELETE /v1/blocks/:id ──────────────────────────────────────────────
register('DELETE', '/v1/blocks/:id', async (req, env, _ctx, params, authedUserId) => {
  if (!authedUserId) return fail(req, 'unauthorised', 401);
  await ensureSchema(env);

  const blockedId = parseUuid(params.id);
  if (!blockedId) return fail(req, 'invalid blockedId', 400);

  await exec(
    env,
    `DELETE FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?`,
    [authedUserId, blockedId],
  );
  return ok(req, { blocked: false });
});

// ── GET /v1/blocks ─────────────────────────────────────────────────────
//
// Returns the caller's blocked user ids, newest-first, so the client can
// filter blocked users out of feeds/chat locally.
register('GET', '/v1/blocks', async (req, env, _ctx, _params, authedUserId) => {
  if (!authedUserId) return fail(req, 'unauthorised', 401);
  await ensureSchema(env);

  const rows = await query<{ blocked_id: string }>(
    env,
    `SELECT blocked_id FROM blocked_users WHERE blocker_id = ? ORDER BY created_at DESC`,
    [authedUserId],
  );
  return ok(req, rows.map((r) => r.blocked_id));
});
