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
import { channels, publishEvent } from '../realtime';

// ── PATCH /v1/comments/:id ──────────────────────────────────────────
register('PATCH', '/v1/comments/:id', async (req, env, ctx, params, authedUserId) => {
  if (!authedUserId) return fail(req, 'unauthorised', 401);
  const id = parseUuid(params.id);
  if (!id) return fail(req, 'invalid comment id', 400);

  const body = await readJson<{ content?: unknown }>(req);
  if (!body.ok) return fail(req, body.error, 400);
  const content = typeof body.value.content === 'string' ? body.value.content.slice(0, 4000) : '';
  if (!content) return fail(req, 'empty comment', 400);

  // Authorship check first — same reason as the delete-post handler.
  // We also lift `post_id` here so the realtime fan-out lands on the
  // correct per-post channel without an extra round trip.
  const owner = await queryOne<{ author_id: string; post_id: string }>(
    env,
    `SELECT author_id, post_id FROM comments WHERE id = ? LIMIT 1`,
    [id],
  );
  if (!owner) return ok(req, { updated: false });
  if (owner.author_id !== authedUserId) return fail(req, 'forbidden', 403);

  await exec(env, `UPDATE comments SET content = ? WHERE id = ?`, [content, id]);
  publishEvent(
    env,
    channels.post(owner.post_id),
    'comment.edit',
    { id, content, post_id: owner.post_id },
    ctx,
  );
  return ok(req, { updated: true });
});

// ── DELETE /v1/comments/:id ────────────────────────────────────────
//
// Optional `?postId=<uuid>` so we can decrement the parent post's
// comments_count atomically. If it's missing we still allow the delete
// (so legacy clients keep working) but skip the counter update.
register('DELETE', '/v1/comments/:id', async (req, env, ctx, params, authedUserId) => {
  if (!authedUserId) return fail(req, 'unauthorised', 401);
  const id = parseUuid(params.id);
  if (!id) return fail(req, 'invalid comment id', 400);

  const url = new URL(req.url);
  const postId = parseUuid(url.searchParams.get('postId'));

  const owner = await queryOne<{ author_id: string; post_id: string }>(
    env,
    `SELECT author_id, post_id FROM comments WHERE id = ? LIMIT 1`,
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
  // Prefer the query-string postId if the client provided it; fall
  // back to the row's own foreign key for legacy callers that don't
  // pass it. Either way the delete event lands on exactly one channel.
  const channelPostId = postId || owner.post_id;
  if (channelPostId) {
    publishEvent(
      env,
      channels.post(channelPostId),
      'comment.delete',
      { id, post_id: channelPostId },
      ctx,
    );
  }
  return ok(req, { deleted: true });
});
