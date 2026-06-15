// Posts endpoints.
//
// `GET /v1/posts/:id`           — single post + author profile via JOIN.
// `GET /v1/posts/:id/comments`  — comments for one post, oldest-first.
//
// Both responses mirror the PostgREST `*, profiles:author_id (...)`
// embed shape so the existing `getXxx` callers in `src/lib/supabase.ts`
// can swap their data source without re-shaping the destructure.
//
// Validation: the post id must be UUID-shaped. A malformed id is a 400
// rather than a 200 + null because we want the app to surface broken
// links / dangling cache entries instead of silently rendering empty.

import { fail, ok } from '../http';
import { register } from '../router';
import { normalizeProfile, query, queryOne } from '../db';
import { parseUuid } from '../util';

interface PostRow {
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

const POST_SELECT_WITH_AUTHOR = `
  SELECT p.id,
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
`;

function shapePost(row: PostRow) {
  return {
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
  };
}

// ── GET /v1/posts/:id ────────────────────────────────────────────────────
register('GET', '/v1/posts/:id', async (req, env, _ctx, params) => {
  const id = parseUuid(params.id);
  if (!id) return fail(req, 'invalid post id', 400);
  const row = await queryOne<PostRow>(
    env,
    `${POST_SELECT_WITH_AUTHOR} WHERE p.id = ? LIMIT 1`,
    [id],
  );
  if (!row) return ok(req, null);
  return ok(req, shapePost(row));
});

// ── GET /v1/posts/:id/comments ──────────────────────────────────────────
//
// Ordered oldest-first because that's how the comments screen reads top
// to bottom (mirroring the existing Supabase `getComments` ordering).
// Comments rarely run into the hundreds for a single post, so we don't
// bother paginating in Phase 2 — we'll add `?limit=&offset=` later if
// load warrants it.
interface CommentRow {
  id: string;
  post_id: string;
  author_id: string;
  content: string;
  created_at: string;
  profile_id: string | null;
  profile_username: string | null;
  profile_display_name: string | null;
  profile_emoji: string | null;
  profile_badge: string | null;
  profile_is_verified: number | null;
}

register('GET', '/v1/posts/:id/comments', async (req, env, _ctx, params) => {
  const postId = parseUuid(params.id);
  if (!postId) return fail(req, 'invalid post id', 400);
  const rows = await query<CommentRow>(
    env,
    `SELECT c.id,
            c.post_id,
            c.author_id,
            c.content,
            c.created_at,
            pr.id            AS profile_id,
            pr.username      AS profile_username,
            pr.display_name  AS profile_display_name,
            pr.emoji         AS profile_emoji,
            pr.badge         AS profile_badge,
            pr.is_verified   AS profile_is_verified
       FROM comments c
  LEFT JOIN profiles pr ON pr.id = c.author_id
      WHERE c.post_id = ?
   ORDER BY c.created_at ASC`,
    [postId],
  );
  const out = rows.map((row) => ({
    id: row.id,
    post_id: row.post_id,
    author_id: row.author_id,
    content: row.content,
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
