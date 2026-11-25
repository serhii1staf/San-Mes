// Comment edit + delete endpoints.
//
// PATCH  /v1/comments/:id              — update the comment text. Author-only.
// DELETE /v1/comments/:id               — remove + decrement the post's comments_count. Author-only.
//                                          A `?postId=` the client still sends is ignored: the
//                                          comment's own row says which post it is on.

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
  // 5000, matching MAX_MESSAGE_CHARS / the comments composer. Was 4000, i.e. BELOW the client
  // cap — so a comment the app let the user type could be silently truncated on write, with no
  // error and no indication which characters were lost.
  const content = typeof body.value.content === 'string' ? body.value.content.slice(0, 5000) : '';
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
register('DELETE', '/v1/comments/:id', async (req, env, ctx, params, authedUserId) => {
  if (!authedUserId) return fail(req, 'unauthorised', 401);
  const id = parseUuid(params.id);
  if (!id) return fail(req, 'invalid comment id', 400);

  const owner = await queryOne<{ author_id: string; post_id: string }>(
    env,
    `SELECT author_id, post_id FROM comments WHERE id = ? LIMIT 1`,
    [id],
  );
  if (!owner) return ok(req, { deleted: false });
  if (owner.author_id !== authedUserId) return fail(req, 'forbidden', 403);

  // ── THE POST IS THE COMMENT'S OWN, NOT THE CALLER'S `?postId` (Nov 2026) ─────────────────────
  //
  // The counter and the realtime event used the query string's post id. Ownership was checked on the
  // comment only, so anyone could write a comment anywhere, delete it with `?postId=<someone else's
  // post>` and take one off that post's comment count each time, and send delete events on its
  // channel. The comment's row knows its post; the parameter is ignored (the app always passed the
  // same id, src/lib/supabase.ts).
  const stmts: { sql: string; params?: unknown[] }[] = [
    { sql: `DELETE FROM comments WHERE id = ?`, params: [id] },
  ];
  if (owner.post_id) {
    stmts.push({
      sql: `UPDATE posts SET comments_count = MAX(COALESCE(comments_count, 0) - 1, 0) WHERE id = ?`,
      params: [owner.post_id],
    });
  }
  await batch(env, stmts);
  const channelPostId = owner.post_id;
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
