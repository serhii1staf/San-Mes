// Posts endpoints — reads (Phase 2) and writes (Phase 3).
//
// Reads:
//   GET    /v1/posts/:id                — single post + author profile via JOIN.
//   GET    /v1/posts/:id/comments       — comments for one post, oldest-first.
//
// Writes (authed):
//   POST   /v1/posts                    — create. Body: { content, image_url? }
//   DELETE /v1/posts/:id                — delete (author-only). Cascades likes,
//                                         comments, and reposts referencing it.
//   POST   /v1/posts/:id/like           — toggle. Increments / decrements
//                                         the post's likes_count atomically.
//   POST   /v1/posts/:id/comments       — add a comment. Bumps comments_count.
//   POST   /v1/posts/repost             — Body: { originalPostId, comment? }
//                                         Inserts a `::repost::…::` post and
//                                         bumps the original's shares_count.
//
// Both response shapes mirror the PostgREST `*, profiles:author_id (...)`
// embed so callers can swap data sources without re-shaping their
// destructure. Validation: post id must be UUID-shaped — malformed →
// 400 so the app surfaces broken links instead of rendering empty.

import { fail, ok } from '../http';
import { register } from '../router';
import { batch, normalizeProfile, query, queryOne } from '../db';
import { parseUuid } from '../util';
import { asStr, readJson } from '../validate';

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

// ── POST /v1/posts/repost ────────────────────────────────────────────
//
// REGISTERED FIRST — the static `/repost` segment must shadow any
// future `:id` capture we add. Body: { originalPostId, comment? }.
register('POST', '/v1/posts/repost', async (req, env, _ctx, _params, authedUserId) => {
  if (!authedUserId) return fail(req, 'unauthorised', 401);
  const body = await readJson<{ originalPostId?: unknown; comment?: unknown }>(req);
  if (!body.ok) return fail(req, body.error, 400);
  const originalPostId = parseUuid(asStr(body.value.originalPostId, 64) || '');
  if (!originalPostId) return fail(req, 'invalid original post id', 400);
  const comment = typeof body.value.comment === 'string' ? body.value.comment.slice(0, 4000) : '';

  // The repost row uses the marker scheme the client already parses
  // (`isRepost` in `src/lib/supabase.ts`):
  //   ::repost::<original-uuid>::<optional comment>
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const content = `::repost::${originalPostId}::${comment}`;

  await batch(env, [
    {
      sql: `INSERT INTO posts (id, author_id, content, image_url, likes_count, comments_count, shares_count, created_at)
            VALUES (?, ?, ?, NULL, 0, 0, 0, ?)`,
      params: [id, authedUserId, content, now],
    },
    {
      sql: `UPDATE posts SET shares_count = COALESCE(shares_count, 0) + 1 WHERE id = ?`,
      params: [originalPostId],
    },
  ]);

  const created = await queryOne<PostRow>(
    env,
    `${POST_SELECT_WITH_AUTHOR} WHERE p.id = ? LIMIT 1`,
    [id],
  );
  return ok(req, created ? shapePost(created) : null);
});

// ── POST /v1/posts ────────────────────────────────────────────────────
//
// Body: { content, image_url? }. Authed only. Returns the new post +
// embedded author profile so callers can render without a refetch.
register('POST', '/v1/posts', async (req, env, _ctx, _params, authedUserId) => {
  if (!authedUserId) return fail(req, 'unauthorised', 401);
  const body = await readJson<{ content?: unknown; image_url?: unknown }>(req);
  if (!body.ok) return fail(req, body.error, 400);

  const content = typeof body.value.content === 'string' ? body.value.content.slice(0, 8000) : '';
  const imageUrl = typeof body.value.image_url === 'string' ? body.value.image_url.slice(0, 4000) : null;
  if (!content && !imageUrl) return fail(req, 'empty post', 400);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const stmt = env.DB.prepare(
    `INSERT INTO posts (id, author_id, content, image_url, likes_count, comments_count, shares_count, created_at)
     VALUES (?, ?, ?, ?, 0, 0, 0, ?)`,
  );
  await stmt.bind(id, authedUserId, content, imageUrl, now).run();

  const created = await queryOne<PostRow>(
    env,
    `${POST_SELECT_WITH_AUTHOR} WHERE p.id = ? LIMIT 1`,
    [id],
  );
  return ok(req, created ? shapePost(created) : null);
});

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

// ── DELETE /v1/posts/:id ─────────────────────────────────────────────
//
// Author-scoped. Cascades: deletes likes + comments + reposts that
// reference this post, then the post itself. Wrapped in a single D1
// batch so the row counts never end up partially applied.
register('DELETE', '/v1/posts/:id', async (req, env, _ctx, params, authedUserId) => {
  if (!authedUserId) return fail(req, 'unauthorised', 401);
  const id = parseUuid(params.id);
  if (!id) return fail(req, 'invalid post id', 400);

  // Authorship check first — prevents a user from triggering a cascade
  // delete on someone else's post via a forged URL.
  const owner = await queryOne<{ author_id: string }>(
    env,
    `SELECT author_id FROM posts WHERE id = ? LIMIT 1`,
    [id],
  );
  if (!owner) return ok(req, { deleted: false });
  if (owner.author_id !== authedUserId) return fail(req, 'forbidden', 403);

  await batch(env, [
    { sql: `DELETE FROM likes WHERE post_id = ?`, params: [id] },
    { sql: `DELETE FROM comments WHERE post_id = ?`, params: [id] },
    { sql: `DELETE FROM posts WHERE content LIKE ?`, params: [`::repost::${id}%`] },
    { sql: `DELETE FROM posts WHERE id = ?`, params: [id] },
  ]);
  return ok(req, { deleted: true });
});

// ── POST /v1/posts/:id/like ──────────────────────────────────────────
//
// Toggle. If a (user_id, post_id) row exists, deletes it and decrements
// the post's likes_count. Otherwise inserts and increments. Atomic via
// D1.batch — clients see one of two stable post states.
register('POST', '/v1/posts/:id/like', async (req, env, _ctx, params, authedUserId) => {
  if (!authedUserId) return fail(req, 'unauthorised', 401);
  const postId = parseUuid(params.id);
  if (!postId) return fail(req, 'invalid post id', 400);

  const existing = await queryOne<{ user_id: string }>(
    env,
    `SELECT user_id FROM likes WHERE user_id = ? AND post_id = ? LIMIT 1`,
    [authedUserId, postId],
  );

  if (existing) {
    await batch(env, [
      { sql: `DELETE FROM likes WHERE user_id = ? AND post_id = ?`, params: [authedUserId, postId] },
      { sql: `UPDATE posts SET likes_count = MAX(COALESCE(likes_count, 0) - 1, 0) WHERE id = ?`, params: [postId] },
    ]);
    return ok(req, { liked: false });
  }

  const now = new Date().toISOString();
  await batch(env, [
    {
      sql: `INSERT OR IGNORE INTO likes (user_id, post_id, created_at) VALUES (?, ?, ?)`,
      params: [authedUserId, postId, now],
    },
    {
      sql: `UPDATE posts SET likes_count = COALESCE(likes_count, 0) + 1 WHERE id = ?`,
      params: [postId],
    },
  ]);
  return ok(req, { liked: true });
});

// ── POST /v1/posts/:id/comments ──────────────────────────────────────
//
// Body: { content }. Authed only. Inserts the comment + bumps the
// post's comments_count atomically. Returns the new comment with the
// author profile embedded.
register('POST', '/v1/posts/:id/comments', async (req, env, _ctx, params, authedUserId) => {
  if (!authedUserId) return fail(req, 'unauthorised', 401);
  const postId = parseUuid(params.id);
  if (!postId) return fail(req, 'invalid post id', 400);

  const body = await readJson<{ content?: unknown }>(req);
  if (!body.ok) return fail(req, body.error, 400);
  const content = typeof body.value.content === 'string' ? body.value.content.slice(0, 4000) : '';
  if (!content) return fail(req, 'empty comment', 400);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await batch(env, [
    {
      sql: `INSERT INTO comments (id, post_id, author_id, content, created_at) VALUES (?, ?, ?, ?, ?)`,
      params: [id, postId, authedUserId, content, now],
    },
    {
      sql: `UPDATE posts SET comments_count = COALESCE(comments_count, 0) + 1 WHERE id = ?`,
      params: [postId],
    },
  ]);

  // Re-read with the author profile embed so the client can render
  // immediately. One extra query is cheap; saves a roundtrip on the
  // optimistic UI side.
  interface Row {
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
  const row = await queryOne<Row>(
    env,
    `SELECT c.id, c.post_id, c.author_id, c.content, c.created_at,
            pr.id            AS profile_id,
            pr.username      AS profile_username,
            pr.display_name  AS profile_display_name,
            pr.emoji         AS profile_emoji,
            pr.badge         AS profile_badge,
            pr.is_verified   AS profile_is_verified
       FROM comments c
  LEFT JOIN profiles pr ON pr.id = c.author_id
      WHERE c.id = ?
      LIMIT 1`,
    [id],
  );
  if (!row) return ok(req, null);
  return ok(req, {
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
  });
});

// ── GET /v1/posts/:id/comments ──────────────────────────────────────────
register('GET', '/v1/posts/:id/comments', async (req, env, _ctx, params) => {
  const postId = parseUuid(params.id);
  if (!postId) return fail(req, 'invalid post id', 400);
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
