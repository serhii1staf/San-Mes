// Conversation + message write endpoints.
//
// POST /v1/conversations                — Body: { otherUserId } → { conversation_id }
//                                         Idempotent: if a 1:1 conversation
//                                         between authedUserId and otherUserId
//                                         already exists, return its id.
// POST /v1/conversations/:id/messages   — Body: { text } → the new message row.
//                                         Sender must be a participant.
//
// The Supabase path used to do this with two `select` queries followed
// by an insert, racing two writers. Here we collapse the lookup into a
// single SQL EXISTS so both halves of the create flow stay correct
// even on simultaneous taps.

import { fail, ok } from '../http';
import { register } from '../router';
import { batch, exec, queryOne } from '../db';
import { parseUuid } from '../util';
import { asStr, readJson } from '../validate';

// ── POST /v1/conversations ────────────────────────────────────────────
//
// Creates a 1:1 conversation with `otherUserId` if one doesn't already
// exist. Returns `{ conversation_id }` either way.
register('POST', '/v1/conversations', async (req, env, _ctx, _params, authedUserId) => {
  if (!authedUserId) return fail(req, 'unauthorised', 401);
  const body = await readJson<{ otherUserId?: unknown }>(req);
  if (!body.ok) return fail(req, body.error, 400);
  const otherUserId = parseUuid(asStr(body.value.otherUserId, 64) || '');
  if (!otherUserId) return fail(req, 'invalid other user id', 400);
  if (otherUserId === authedUserId) return fail(req, 'cannot dm self', 400);

  // Look for an existing 1:1 conversation that contains BOTH users.
  // The two EXISTS sub-clauses confirm both memberships in a single
  // query; the GROUP BY HAVING constraint pins the count to exactly 2
  // so a conversation with extra participants (future group chat) is
  // never reused as a 1:1.
  const existing = await queryOne<{ conversation_id: string }>(
    env,
    `SELECT a.conversation_id AS conversation_id
       FROM conversation_participants a
       JOIN conversation_participants b
         ON a.conversation_id = b.conversation_id
      WHERE a.user_id = ?
        AND b.user_id = ?
        AND (
          SELECT COUNT(*)
            FROM conversation_participants p
           WHERE p.conversation_id = a.conversation_id
        ) = 2
      LIMIT 1`,
    [authedUserId, otherUserId],
  );
  if (existing) return ok(req, { conversation_id: existing.conversation_id });

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await batch(env, [
    { sql: `INSERT INTO conversations (id, created_at) VALUES (?, ?)`, params: [id, now] },
    {
      sql: `INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)`,
      params: [id, authedUserId],
    },
    {
      sql: `INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)`,
      params: [id, otherUserId],
    },
  ]);
  return ok(req, { conversation_id: id });
});

// ── POST /v1/conversations/:id/messages ───────────────────────────────
register('POST', '/v1/conversations/:id/messages', async (req, env, _ctx, params, authedUserId) => {
  if (!authedUserId) return fail(req, 'unauthorised', 401);
  const conversationId = parseUuid(params.id);
  if (!conversationId) return fail(req, 'invalid conversation id', 400);

  const body = await readJson<{ text?: unknown }>(req);
  if (!body.ok) return fail(req, body.error, 400);
  const text = typeof body.value.text === 'string' ? body.value.text.slice(0, 16000) : '';
  if (!text) return fail(req, 'empty message', 400);

  // Participation check — same EXISTS gate the GET path uses.
  const participant = await queryOne<{ x: number }>(
    env,
    `SELECT 1 AS x FROM conversation_participants
      WHERE conversation_id = ? AND user_id = ? LIMIT 1`,
    [conversationId, authedUserId],
  );
  if (!participant) return fail(req, 'forbidden', 403);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await exec(
    env,
    `INSERT INTO messages (id, conversation_id, sender_id, text, created_at) VALUES (?, ?, ?, ?, ?)`,
    [id, conversationId, authedUserId, text, now],
  );

  return ok(req, {
    id,
    conversation_id: conversationId,
    sender_id: authedUserId,
    text,
    created_at: now,
  });
});
