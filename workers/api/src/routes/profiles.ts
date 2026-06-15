// Profile endpoints.
//
// Order of registration matters: literal-prefixed routes
// (`/by-username/:n`, `/by-device-key/:k`) MUST land in the ROUTES
// array BEFORE `/:id` so the dispatcher's first-match-wins logic
// doesn't capture `by-username` as a UUID. Sub-resources for a single
// profile (`/posts`, `/replies`, `/likes`, `/followers`, `/following`,
// `/follow-counts`) come after the by-id endpoint because they have a
// longer matching path — but the dispatcher still walks them in order,
// so we register the more specific patterns first.

import { fail, ok } from '../http';
import { register } from '../router';
import { normalizeProfile, query, queryOne } from '../db';
import { parseLimit, parseOffset, parseUuid } from '../util';

// ── helpers ─────────────────────────────────────────────────────────────

const PROFILE_FULL_COLUMNS = `id, username, display_name, emoji, bio, pin_hash, device_key, banner_url, links, badge, is_verified, created_at, updated_at`;

// Compact projection used wherever a profile is embedded inside another
// row — same columns the existing PostgREST embeds project. Keeping it
// minimal saves bytes on feed-shaped responses.
const PROFILE_EMBED_COLUMNS = `id, username, display_name, emoji, badge, is_verified, links`;

// ── GET /v1/profiles/by-username/:username ──────────────────────────────
//
// Looks up a single profile by username (the `@mention` autocompleter
// uses this). The lookup is unique-indexed and returns the full row
// shape. Empty match → 200 + null (mirrors `.single()` semantics).
register('GET', '/v1/profiles/by-username/:username', async (req, env, _ctx, params) => {
  const username = (params.username || '').trim();
  if (!username || username.length > 64) return fail(req, 'invalid username', 400);
  const row = await queryOne<Record<string, unknown>>(
    env,
    `SELECT ${PROFILE_FULL_COLUMNS} FROM profiles WHERE username = ? LIMIT 1`,
    [username],
  );
  return ok(req, normalizeProfile(row));
});

// ── GET /v1/profiles/by-device-key/:deviceKey ──────────────────────────
//
// AccountSwitcher uses this to find a profile that shares the current
// device key. Device keys are opaque base-encoded strings; we
// length-cap to keep the bind safe even though the parameter is bound,
// not concatenated.
register('GET', '/v1/profiles/by-device-key/:deviceKey', async (req, env, _ctx, params) => {
  const deviceKey = (params.deviceKey || '').trim();
  if (!deviceKey || deviceKey.length > 128) return fail(req, 'invalid device key', 400);
  const row = await queryOne<Record<string, unknown>>(
    env,
    `SELECT ${PROFILE_FULL_COLUMNS} FROM profiles WHERE device_key = ? LIMIT 1`,
    [deviceKey],
  );
  return ok(req, normalizeProfile(row));
});

// ── GET /v1/profiles?limit=50 ──────────────────────────────────────────
//
// Discover list, newest-first. Page size capped at 50 (matches the
// existing `getProfiles()` cap in supabase.ts).
register('GET', '/v1/profiles', async (req, env) => {
  const url = new URL(req.url);
  const limit = parseLimit(url.searchParams.get('limit'), 50, 50);
  const rows = await query<Record<string, unknown>>(
    env,
    `SELECT ${PROFILE_FULL_COLUMNS} FROM profiles ORDER BY created_at DESC LIMIT ?`,
    [limit],
  );
  return ok(req, rows.map((r) => normalizeProfile(r)).filter(Boolean));
});

// ── GET /v1/profiles/:id/posts?limit=25 ────────────────────────────────
//
// One author's posts, newest-first. Composite index
// `idx_posts_author_created (author_id, created_at DESC)` covers
// both the WHERE and the ORDER BY. The author profile is JOINed in
// so consumers can render the row without a follow-up query.
register('GET', '/v1/profiles/:id/posts', async (req, env, _ctx, params) => {
  const id = parseUuid(params.id);
  if (!id) return fail(req, 'invalid profile id', 400);
  const url = new URL(req.url);
  const limit = parseLimit(url.searchParams.get('limit'), 50, 25);
  const offset = parseOffset(url.searchParams.get('offset'));

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
  }
  const rows = await query<Row>(
    env,
    `SELECT p.id,
            p.author_id,
            p.content,
            p.image_url,
            p.likes_count,
            p.comments_count,
            p.shares_count,
            p.created_at,
            pr.id            AS profile_id,
            pr.username      AS profile_username,
            pr.display_name  AS profile_display_name,
            pr.emoji         AS profile_emoji,
            pr.badge         AS profile_badge,
            pr.is_verified   AS profile_is_verified
       FROM posts p
  LEFT JOIN profiles pr ON pr.id = p.author_id
      WHERE p.author_id = ?
   ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?`,
    [id, limit, offset],
  );
  const out = rows.map((row) => ({
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
          links: null,
        })
      : null,
  }));
  return ok(req, out);
});

// ── GET /v1/profiles/:id/replies?limit=25 ─────────────────────────────
//
// Comments authored by this user. Mirrors `getUserComments` in
// supabase.ts: each reply embeds the parent post + that post's author
// profile so the "in reply to" snippet renders without a second query.
//
// SQLite-side note: the embed shape `posts: { … profiles: { … } }`
// can't be expressed as a single PostgREST join, so we hand-shape it
// from the flat row in JS. Two LEFT JOINs (comments → posts → posts'
// author profile) cover it in one trip.
register('GET', '/v1/profiles/:id/replies', async (req, env, _ctx, params) => {
  const id = parseUuid(params.id);
  if (!id) return fail(req, 'invalid profile id', 400);
  const url = new URL(req.url);
  const limit = parseLimit(url.searchParams.get('limit'), 100, 25);

  interface Row {
    id: string;
    post_id: string;
    content: string;
    created_at: string;
    parent_post_id: string | null;
    parent_post_content: string | null;
    parent_post_image_url: string | null;
    parent_post_author_id: string | null;
    parent_author_id: string | null;
    parent_author_username: string | null;
    parent_author_display_name: string | null;
    parent_author_emoji: string | null;
    parent_author_is_verified: number | null;
  }
  const rows = await query<Row>(
    env,
    `SELECT c.id,
            c.post_id,
            c.content,
            c.created_at,
            pp.id           AS parent_post_id,
            pp.content      AS parent_post_content,
            pp.image_url    AS parent_post_image_url,
            pp.author_id    AS parent_post_author_id,
            pa.id           AS parent_author_id,
            pa.username     AS parent_author_username,
            pa.display_name AS parent_author_display_name,
            pa.emoji        AS parent_author_emoji,
            pa.is_verified  AS parent_author_is_verified
       FROM comments c
  LEFT JOIN posts    pp ON pp.id = c.post_id
  LEFT JOIN profiles pa ON pa.id = pp.author_id
      WHERE c.author_id = ?
   ORDER BY c.created_at DESC
      LIMIT ?`,
    [id, limit],
  );
  const out = rows.map((row) => ({
    id: row.id,
    post_id: row.post_id,
    content: row.content,
    created_at: row.created_at,
    posts: row.parent_post_id
      ? {
          id: row.parent_post_id,
          content: row.parent_post_content,
          image_url: row.parent_post_image_url,
          author_id: row.parent_post_author_id,
          profiles: row.parent_author_id
            ? normalizeProfile({
                id: row.parent_author_id,
                username: row.parent_author_username,
                display_name: row.parent_author_display_name,
                emoji: row.parent_author_emoji,
                is_verified: row.parent_author_is_verified,
                links: null,
              })
            : null,
        }
      : null,
  }));
  return ok(req, out);
});

// ── GET /v1/profiles/:id/likes?limit=25 ───────────────────────────────
//
// Posts that the user has liked, with the post's author profile
// embedded. Mirrors `getLikedPosts` in supabase.ts.
register('GET', '/v1/profiles/:id/likes', async (req, env, _ctx, params) => {
  const id = parseUuid(params.id);
  if (!id) return fail(req, 'invalid profile id', 400);
  const url = new URL(req.url);
  const limit = parseLimit(url.searchParams.get('limit'), 100, 25);

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
  }
  const rows = await query<Row>(
    env,
    `SELECT p.id,
            p.author_id,
            p.content,
            p.image_url,
            p.likes_count,
            p.comments_count,
            p.shares_count,
            p.created_at,
            pr.id            AS profile_id,
            pr.username      AS profile_username,
            pr.display_name  AS profile_display_name,
            pr.emoji         AS profile_emoji,
            pr.badge         AS profile_badge,
            pr.is_verified   AS profile_is_verified
       FROM likes l
       JOIN posts p     ON p.id = l.post_id
  LEFT JOIN profiles pr ON pr.id = p.author_id
      WHERE l.user_id = ?
   ORDER BY l.created_at DESC
      LIMIT ?`,
    [id, limit],
  );
  const out = rows.map((row) => ({
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
          links: null,
        })
      : null,
  }));
  return ok(req, out);
});

// ── GET /v1/profiles/:id/followers?limit=50&offset=0 ──────────────────
//
// Users who follow `:id`, newest-follow first. Single JOIN replaces
// the two-step query the Supabase version had to do because of an FK
// quirk (see `services/follow.ts`).
register('GET', '/v1/profiles/:id/followers', async (req, env, _ctx, params) => {
  const id = parseUuid(params.id);
  if (!id) return fail(req, 'invalid profile id', 400);
  const url = new URL(req.url);
  const limit = parseLimit(url.searchParams.get('limit'), 200, 50);
  const offset = parseOffset(url.searchParams.get('offset'));

  const rows = await query<Record<string, unknown>>(
    env,
    `SELECT ${PROFILE_EMBED_COLUMNS.split(',').map((c) => `pr.${c.trim()}`).join(', ')}
       FROM follows f
       JOIN profiles pr ON pr.id = f.follower_id
      WHERE f.following_id = ?
   ORDER BY f.created_at DESC
      LIMIT ? OFFSET ?`,
    [id, limit, offset],
  );
  return ok(req, rows.map((r) => normalizeProfile(r)).filter(Boolean));
});

// ── GET /v1/profiles/:id/following?limit=50&offset=0 ──────────────────
register('GET', '/v1/profiles/:id/following', async (req, env, _ctx, params) => {
  const id = parseUuid(params.id);
  if (!id) return fail(req, 'invalid profile id', 400);
  const url = new URL(req.url);
  const limit = parseLimit(url.searchParams.get('limit'), 200, 50);
  const offset = parseOffset(url.searchParams.get('offset'));

  const rows = await query<Record<string, unknown>>(
    env,
    `SELECT ${PROFILE_EMBED_COLUMNS.split(',').map((c) => `pr.${c.trim()}`).join(', ')}
       FROM follows f
       JOIN profiles pr ON pr.id = f.following_id
      WHERE f.follower_id = ?
   ORDER BY f.created_at DESC
      LIMIT ? OFFSET ?`,
    [id, limit, offset],
  );
  return ok(req, rows.map((r) => normalizeProfile(r)).filter(Boolean));
});

// ── GET /v1/profiles/:id/follow-counts ─────────────────────────────────
//
// Two scalar counts in a single trip. The composite indexes on
// `follows(follower_id, …)` and `(following_id, …)` cover both COUNTs.
register('GET', '/v1/profiles/:id/follow-counts', async (req, env, _ctx, params) => {
  const id = parseUuid(params.id);
  if (!id) return fail(req, 'invalid profile id', 400);
  const row = await queryOne<{ followers: number; following: number }>(
    env,
    `SELECT
        (SELECT COUNT(*) FROM follows WHERE following_id = ?) AS followers,
        (SELECT COUNT(*) FROM follows WHERE follower_id  = ?) AS following`,
    [id, id],
  );
  return ok(req, {
    followers: row?.followers ?? 0,
    following: row?.following ?? 0,
  });
});

// ── GET /v1/profiles/:id ───────────────────────────────────────────────
//
// MUST be registered AFTER the literal-prefixed `/by-username` and
// `/by-device-key` so those don't get captured as a UUID; AFTER the
// sub-resource routes (`/posts`, `/replies`, `/likes`, `/followers`,
// `/following`, `/follow-counts`) so a longer pattern wins on a deeper
// path.
register('GET', '/v1/profiles/:id', async (req, env, _ctx, params) => {
  const id = parseUuid(params.id);
  if (!id) return fail(req, 'invalid profile id', 400);
  const row = await queryOne<Record<string, unknown>>(
    env,
    `SELECT ${PROFILE_FULL_COLUMNS} FROM profiles WHERE id = ? LIMIT 1`,
    [id],
  );
  return ok(req, normalizeProfile(row));
});
