// Admin endpoints — gated by the `X-Admin-Key` header (compared against
// the `ADMIN_KEY` Worker secret). Used by:
//   - the in-app admin panel (`app/settings/admin.tsx`) so the same UI
//     works without Supabase
//   - the Vercel server-side `/api/*` functions that previously hit
//     Supabase REST (now route through the Worker instead).
//
// These routes BYPASS the per-user JWT auth — the admin key is the
// auth — so they MUST be cheap to enumerate. Each handler does its own
// `assertAdmin(req, env)` gate at the top before running any D1 query.
//
// Endpoints:
//   GET    /v1/admin/profiles?limit=50           — list users newest-first.
//   GET    /v1/admin/profiles/:id                — single profile by id (full row).
//   GET    /v1/admin/profiles/by-username/:n     — single profile by username.
//   GET    /v1/admin/profiles/:id/posts?limit=30 — that user's posts newest-first.
//   GET    /v1/admin/posts/:id                   — single post + author embed.
//   PATCH  /v1/admin/profiles/:id                — toggle is_verified / set badge / etc.
//   DELETE /v1/admin/posts/:id                   — admin force-delete (no author check).

import { fail, ok } from '../http';
import { register } from '../router';
import { batch, exec, normalizeProfile, query, queryOne } from '../db';
import { parseLimit, parseUuid } from '../util';
import { readJson } from '../validate';

const PROFILE_FULL_COLUMNS = `id, username, display_name, emoji, bio, pin_hash, device_key, banner_url, links, badge, is_verified, created_at, updated_at`;

function assertAdmin(req: Request, env: import('../db').Env): Response | null {
  const expected = env.ADMIN_KEY;
  if (!expected) return fail(req, 'admin not configured', 503);
  const provided = req.headers.get('X-Admin-Key') || req.headers.get('x-admin-key');
  if (provided !== expected) return fail(req, 'unauthorised', 401);
  return null;
}

// ── GET /v1/admin/counts ─────────────────────────────────────────────
//
// Returns row counts for the principal tables. Used by the in-app
// services-status panel + the Vercel `/api/admin/status` endpoint.
register('GET', '/v1/admin/counts', async (req, env) => {
  const guard = assertAdmin(req, env);
  if (guard) return guard;
  const row = await queryOne<{ profiles: number; posts: number; comments: number; posts_with_img: number }>(
    env,
    `SELECT
        (SELECT COUNT(*) FROM profiles) AS profiles,
        (SELECT COUNT(*) FROM posts)    AS posts,
        (SELECT COUNT(*) FROM comments) AS comments,
        (SELECT COUNT(*) FROM posts WHERE image_url IS NOT NULL AND image_url != '') AS posts_with_img`,
    [],
  );
  return ok(req, {
    profiles: row?.profiles ?? 0,
    posts: row?.posts ?? 0,
    comments: row?.comments ?? 0,
    posts_with_img: row?.posts_with_img ?? 0,
  });
});

// ── GET /v1/admin/profiles ────────────────────────────────────────────
register('GET', '/v1/admin/profiles', async (req, env) => {
  const guard = assertAdmin(req, env);
  if (guard) return guard;
  const url = new URL(req.url);
  const limit = parseLimit(url.searchParams.get('limit'), 200, 50);
  const rows = await query<Record<string, unknown>>(
    env,
    `SELECT ${PROFILE_FULL_COLUMNS} FROM profiles ORDER BY created_at DESC LIMIT ?`,
    [limit],
  );
  return ok(req, rows.map((r) => normalizeProfile(r)).filter(Boolean));
});

// ── GET /v1/admin/profiles/by-username/:n ─────────────────────────────
register('GET', '/v1/admin/profiles/by-username/:username', async (req, env, _ctx, params) => {
  const guard = assertAdmin(req, env);
  if (guard) return guard;
  const username = (params.username || '').trim();
  if (!username) return fail(req, 'invalid username', 400);
  const row = await queryOne<Record<string, unknown>>(
    env,
    `SELECT ${PROFILE_FULL_COLUMNS} FROM profiles WHERE username = ? LIMIT 1`,
    [username],
  );
  return ok(req, normalizeProfile(row));
});

// ── GET /v1/admin/profiles/:id/posts ──────────────────────────────────
register('GET', '/v1/admin/profiles/:id/posts', async (req, env, _ctx, params) => {
  const guard = assertAdmin(req, env);
  if (guard) return guard;
  const id = parseUuid(params.id);
  if (!id) return fail(req, 'invalid profile id', 400);
  const url = new URL(req.url);
  const limit = parseLimit(url.searchParams.get('limit'), 100, 30);
  const rows = await query<Record<string, unknown>>(
    env,
    `SELECT id, author_id, content, image_url, likes_count, comments_count, shares_count, created_at
       FROM posts
      WHERE author_id = ?
   ORDER BY created_at DESC
      LIMIT ?`,
    [id, limit],
  );
  return ok(req, rows);
});

// ── GET /v1/admin/profiles/:id ────────────────────────────────────────
register('GET', '/v1/admin/profiles/:id', async (req, env, _ctx, params) => {
  const guard = assertAdmin(req, env);
  if (guard) return guard;
  const id = parseUuid(params.id);
  if (!id) return fail(req, 'invalid profile id', 400);
  const row = await queryOne<Record<string, unknown>>(
    env,
    `SELECT ${PROFILE_FULL_COLUMNS} FROM profiles WHERE id = ? LIMIT 1`,
    [id],
  );
  return ok(req, normalizeProfile(row));
});

// ── PATCH /v1/admin/profiles/:id ──────────────────────────────────────
//
// Body: { is_verified?, badge?, display_name?, emoji?, bio?, banner_url?, links? }
register('PATCH', '/v1/admin/profiles/:id', async (req, env, _ctx, params) => {
  const guard = assertAdmin(req, env);
  if (guard) return guard;
  const id = parseUuid(params.id);
  if (!id) return fail(req, 'invalid profile id', 400);
  const body = await readJson<Record<string, unknown>>(req);
  if (!body.ok) return fail(req, body.error, 400);
  const v = body.value;

  const sets: string[] = [];
  const binds: unknown[] = [];
  if (typeof v.is_verified === 'boolean') {
    sets.push('is_verified = ?');
    binds.push(v.is_verified ? 1 : 0);
  }
  if (typeof v.badge === 'string' || v.badge === null) {
    sets.push('badge = ?');
    binds.push(v.badge == null ? null : String(v.badge).slice(0, 32));
  }
  if (typeof v.display_name === 'string') {
    sets.push('display_name = ?');
    binds.push(v.display_name.slice(0, 64));
  }
  if (typeof v.emoji === 'string') {
    sets.push('emoji = ?');
    binds.push(v.emoji.slice(0, 16));
  }
  if (typeof v.bio === 'string') {
    sets.push('bio = ?');
    binds.push(v.bio.slice(0, 240));
  }
  if (typeof v.banner_url === 'string' || v.banner_url === null) {
    sets.push('banner_url = ?');
    binds.push(v.banner_url == null ? null : String(v.banner_url).slice(0, 4000));
  }
  if (Array.isArray(v.links) || v.links === null) {
    sets.push('links = ?');
    binds.push(v.links == null ? null : JSON.stringify(v.links));
  }
  if (sets.length === 0) {
    const cur = await queryOne<Record<string, unknown>>(
      env,
      `SELECT ${PROFILE_FULL_COLUMNS} FROM profiles WHERE id = ? LIMIT 1`,
      [id],
    );
    return ok(req, normalizeProfile(cur));
  }
  sets.push('updated_at = ?');
  binds.push(new Date().toISOString());
  binds.push(id);
  await exec(env, `UPDATE profiles SET ${sets.join(', ')} WHERE id = ?`, binds);
  const updated = await queryOne<Record<string, unknown>>(
    env,
    `SELECT ${PROFILE_FULL_COLUMNS} FROM profiles WHERE id = ? LIMIT 1`,
    [id],
  );
  return ok(req, normalizeProfile(updated));
});

// ── GET /v1/admin/posts/:id ───────────────────────────────────────────
//
// Used by the Vercel SSR functions to render share-link previews
// (`/post/:id`) without going through Supabase REST.
register('GET', '/v1/admin/posts/:id', async (req, env, _ctx, params) => {
  const guard = assertAdmin(req, env);
  if (guard) return guard;
  const id = parseUuid(params.id);
  if (!id) return fail(req, 'invalid post id', 400);
  interface Row {
    id: string;
    author_id: string;
    content: string;
    image_url: string | null;
    likes_count: number;
    comments_count: number;
    shares_count: number;
    created_at: string;
    profile_id: string | null;
    profile_username: string | null;
    profile_display_name: string | null;
    profile_emoji: string | null;
    profile_badge: string | null;
    profile_is_verified: number | null;
    profile_banner_url: string | null;
    profile_bio: string | null;
  }
  const row = await queryOne<Row>(
    env,
    `SELECT p.id, p.author_id, p.content, p.image_url, p.likes_count, p.comments_count, p.shares_count, p.created_at,
            pr.id            AS profile_id,
            pr.username      AS profile_username,
            pr.display_name  AS profile_display_name,
            pr.emoji         AS profile_emoji,
            pr.badge         AS profile_badge,
            pr.is_verified   AS profile_is_verified,
            pr.banner_url    AS profile_banner_url,
            pr.bio           AS profile_bio
       FROM posts p
  LEFT JOIN profiles pr ON pr.id = p.author_id
      WHERE p.id = ?
      LIMIT 1`,
    [id],
  );
  if (!row) return ok(req, null);
  return ok(req, {
    id: row.id,
    author_id: row.author_id,
    content: row.content,
    image_url: row.image_url,
    likes_count: row.likes_count,
    comments_count: row.comments_count,
    shares_count: row.shares_count,
    created_at: row.created_at,
    profiles: row.profile_id
      ? normalizeProfile({
          id: row.profile_id,
          username: row.profile_username,
          display_name: row.profile_display_name,
          emoji: row.profile_emoji,
          badge: row.profile_badge,
          is_verified: row.profile_is_verified,
          banner_url: row.profile_banner_url,
          bio: row.profile_bio,
          links: null,
        })
      : null,
  });
});

// ── DELETE /v1/admin/posts/:id ────────────────────────────────────────
//
// Admin force-delete with full cascade — same shape as the in-app
// `adminDeletePost` flow.
register('DELETE', '/v1/admin/posts/:id', async (req, env, _ctx, params) => {
  const guard = assertAdmin(req, env);
  if (guard) return guard;
  const id = parseUuid(params.id);
  if (!id) return fail(req, 'invalid post id', 400);
  await batch(env, [
    { sql: `DELETE FROM likes WHERE post_id = ?`, params: [id] },
    { sql: `DELETE FROM comments WHERE post_id = ?`, params: [id] },
    { sql: `DELETE FROM posts WHERE content LIKE ?`, params: [`::repost::${id}%`] },
    { sql: `DELETE FROM posts WHERE id = ?`, params: [id] },
  ]);
  return ok(req, { deleted: true });
});
