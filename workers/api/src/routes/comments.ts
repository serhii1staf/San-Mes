// Comment edit + delete endpoints.
//
// PATCH  /v1/comments/:id              — update the comment text. Author-only.
// DELETE /v1/comments/:id?postId=<uuid> — remove + decrement the post's
//                                          comments_count. Author-only.
//
// `postId` is a query param so the Worker can update the parent post's
// counter without an extra round-trip — same shape as the existing
// client-side flow in `deleteComment`.

import { fail, ok } from '../http';
import { register } from '../router';
import { batch, exec, queryOne } from '../db';
import { parseUuid } from '../util';
import { readJson } from '../validate';

// ── PATCH /v1/comments/:id ──────────────────────────────────────────
register('PATCH', '/v1/comments/:id', async (req, env, _ctx, params, authedUserId) => {
  if (!authedUserId) return fail(req, 'unauthorised', 401);
  const id = parseUuid(params.id);
  if (!id) return fail(req, 'invalid comment id', 400);

  const body = await readJson<{ content?: unknown }>(req);
  if (!body.ok) return fail(req, body.error, 400);
  const content = typeof body.value.content === 'string' ? body.value.content.slice(0, 4000) : '';
  if (!content) return fail(req, 'empty comment', 400);

  // Authorship check first — same reason as the delete-post handler.
  const owner = await queryOne<{ author_id: string }>(
    env,
    `SELECT author_id FROM comments WHERE id = ? LIMIT 1`,
    [id],
  );
  if (!owner) return ok(req, { updated: false });
  if (owner.author_id !== authedUserId) return fail(req, 'forbidden', 403);

  await exec(env, `UPDATE comments SET content = ? WHERE id = ?`, [content, id]);
  return ok(req, { updated: true });
});

// ── DELETE /v1/comments/:id ────────────────────────────────────────
//
// Optional `?postId=<uuid>` so we can decrement the parent post's
// comments_count atomically. If it's missing we still allow the delete
// (so legacy clients keep working) but skip the counter update.
register('DELETE', '/v1/comments/:id', async (req, env, _ctx, params, authedUserId) => {
  if (!authedUserId) return fail(req, 'unauthorised', 401);
  const id = parseUuid(params.id);
  if (!id) return fail(req, 'invalid comment id', 400);

  const url = new URL(req.url);
  const postId = parseUuid(url.searchParams.get('postId'));

  const owner = await queryOne<{ author_id: string }>(
    env,
    `SELECT author_id FROM comments WHERE id = ? LIMIT 1`,
    [id],
  );
  if (!owner) return ok(req, { deleted: false });
  if (owner.author_id !== authedUserId) return fail(req, 'forbidden', 403);

  const stmts: { sql: string; params?: unknown[] }[] = [
    { sql: `DELETE FROM comments WHERE id = ?`, params: [id] },
  ];
  if (postId) {
    stmts.push({
      sql: `UPDATE posts SET comments_count = MAX(COALESCE(comments_count, 0) - 1, 0) WHERE id = ?`,
      params: [postId],
    });
  }
  await batch(env, stmts);
  return ok(req, { deleted: true });
});
