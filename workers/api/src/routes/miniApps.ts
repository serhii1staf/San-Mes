// Mini-apps endpoints — reads (Phase 2) and writes (Phase 3).
//
// GET    /v1/mini-apps?limit=50    — list, newest first.
// GET    /v1/mini-apps/:id         — single + creator profile embed.
// POST   /v1/mini-apps             — Body: { name, description, emoji, url }
// PATCH  /v1/mini-apps/:id         — partial update; creator-only.
// DELETE /v1/mini-apps/:id         — remove; creator-only.

import { fail, ok } from '../http';
import { register } from '../router';
import { exec, normalizeProfile, query, queryOne } from '../db';
import { parseLimit, parseUuid } from '../util';
import { readJson } from '../validate';

// ── GET /v1/mini-apps ──────────────────────────────────────────────────
register('GET', '/v1/mini-apps', async (req, env) => {
  const url = new URL(req.url);
  const limit = parseLimit(url.searchParams.get('limit'), 100, 50);
  const rows = await query<{
    id: string;
    creator_id: string;
    name: string;
    description: string;
    emoji: string;
    url: string;
    created_at: string;
  }>(
    env,
    `SELECT id, creator_id, name, description, emoji, url, created_at
       FROM mini_apps
   ORDER BY created_at DESC
      LIMIT ?`,
    [limit],
  );
  return ok(req, rows);
});

// ── POST /v1/mini-apps ────────────────────────────────────────────────
//
// Body: { name, description, emoji, url }. Authed only.
register('POST', '/v1/mini-apps', async (req, env, _ctx, _params, authedUserId) => {
  if (!authedUserId) return fail(req, 'unauthorised', 401);
  const body = await readJson<{
    name?: unknown;
    description?: unknown;
    emoji?: unknown;
    url?: unknown;
  }>(req);
  if (!body.ok) return fail(req, body.error, 400);

  const name = typeof body.value.name === 'string' ? body.value.name.slice(0, 80).trim() : '';
  const description = typeof body.value.description === 'string' ? body.value.description.slice(0, 240) : '';
  const emoji = typeof body.value.emoji === 'string' ? body.value.emoji.slice(0, 16) : '🧩';
  const target = typeof body.value.url === 'string' ? body.value.url.slice(0, 2048).trim() : '';
  if (!name) return fail(req, 'invalid name', 400);
  if (!target || !/^https?:\/\//i.test(target)) return fail(req, 'invalid url', 400);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await exec(
    env,
    `INSERT INTO mini_apps (id, creator_id, name, description, emoji, url, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, authedUserId, name, description, emoji, target, now],
  );
  const created = await fetchMiniAppWithCreator(env, id);
  return ok(req, created);
});

// ── PATCH /v1/mini-apps/:id ───────────────────────────────────────────
register('PATCH', '/v1/mini-apps/:id', async (req, env, _ctx, params, authedUserId) => {
  if (!authedUserId) return fail(req, 'unauthorised', 401);
  const id = parseUuid(params.id);
  if (!id) return fail(req, 'invalid mini-app id', 400);

  const body = await readJson<{
    name?: unknown;
    description?: unknown;
    emoji?: unknown;
    url?: unknown;
  }>(req);
  if (!body.ok) return fail(req, body.error, 400);

  const owner = await queryOne<{ creator_id: string }>(
    env,
    `SELECT creator_id FROM mini_apps WHERE id = ? LIMIT 1`,
    [id],
  );
  if (!owner) return ok(req, null);
  if (owner.creator_id !== authedUserId) return fail(req, 'forbidden', 403);

  // Build a partial-update statement from whichever fields the body
  // actually sends. We never set a column to NULL implicitly — only
  // present-and-typed fields make it into the SET clause.
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (typeof body.value.name === 'string') {
    sets.push('name = ?');
    binds.push(body.value.name.slice(0, 80).trim());
  }
  if (typeof body.value.description === 'string') {
    sets.push('description = ?');
    binds.push(body.value.description.slice(0, 240));
  }
  if (typeof body.value.emoji === 'string') {
    sets.push('emoji = ?');
    binds.push(body.value.emoji.slice(0, 16));
  }
  if (typeof body.value.url === 'string') {
    const u = body.value.url.slice(0, 2048).trim();
    if (!/^https?:\/\//i.test(u)) return fail(req, 'invalid url', 400);
    sets.push('url = ?');
    binds.push(u);
  }
  if (sets.length === 0) return ok(req, await fetchMiniAppWithCreator(env, id));

  binds.push(id);
  await exec(env, `UPDATE mini_apps SET ${sets.join(', ')} WHERE id = ?`, binds);
  return ok(req, await fetchMiniAppWithCreator(env, id));
});

// ── DELETE /v1/mini-apps/:id ──────────────────────────────────────────
register('DELETE', '/v1/mini-apps/:id', async (req, env, _ctx, params, authedUserId) => {
  if (!authedUserId) return fail(req, 'unauthorised', 401);
  const id = parseUuid(params.id);
  if (!id) return fail(req, 'invalid mini-app id', 400);

  const owner = await queryOne<{ creator_id: string }>(
    env,
    `SELECT creator_id FROM mini_apps WHERE id = ? LIMIT 1`,
    [id],
  );
  if (!owner) return ok(req, { deleted: false });
  if (owner.creator_id !== authedUserId) return fail(req, 'forbidden', 403);

  await exec(env, `DELETE FROM mini_apps WHERE id = ?`, [id]);
  return ok(req, { deleted: true });
});

// ── GET /v1/mini-apps/:id ──────────────────────────────────────────────
//
// Embeds the creator profile so the share-landing screen can render
// "made by @user" without a follow-up trip. Empty match → 200 + null.
register('GET', '/v1/mini-apps/:id', async (req, env, _ctx, params) => {
  const id = parseUuid(params.id);
  if (!id) return fail(req, 'invalid mini-app id', 400);
  const out = await fetchMiniAppWithCreator(env, id);
  return ok(req, out);
});

// Shared shape helper used by the GET-by-id, POST, and PATCH responses.
async function fetchMiniAppWithCreator(env: import('../db').Env, id: string) {
  interface Row {
    id: string;
    creator_id: string;
    name: string;
    description: string;
    emoji: string;
    url: string;
    created_at: string;
    profile_id: string | null;
    profile_username: string | null;
    profile_display_name: string | null;
    profile_emoji: string | null;
    profile_badge: string | null;
    profile_is_verified: number | null;
  }
  const row = await queryOne<Row>(
    env,
    `SELECT m.id,
            m.creator_id,
            m.name,
            m.description,
            m.emoji,
            m.url,
            m.created_at,
            pr.id            AS profile_id,
            pr.username      AS profile_username,
            pr.display_name  AS profile_display_name,
            pr.emoji         AS profile_emoji,
            pr.badge         AS profile_badge,
            pr.is_verified   AS profile_is_verified
       FROM mini_apps m
  LEFT JOIN profiles pr ON pr.id = m.creator_id
      WHERE m.id = ?
      LIMIT 1`,
    [id],
  );
  if (!row) return null;
  return {
    id: row.id,
    creator_id: row.creator_id,
    name: row.name,
    description: row.description,
    emoji: row.emoji,
    url: row.url,
    created_at: row.created_at,
    profiles: row.profile_id
      ? normalizeProfile({
          id: row.profile_id,
          username: row.profile_username,
          display_name: row.profile_display_name,
          emoji: row.profile_emoji,
          badge: row.profile_badge,
          is_verified: row.profile_is_verified,
          links: null,
        })
      : null,
  };
}
