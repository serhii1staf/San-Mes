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
import { batch, exec, query, queryOne } from '../db';
import { parseUuid } from '../util';
import { asStr, readJson } from '../validate';
import { channels, publishEvent } from '../realtime';
import { sendPushToUser, cleanPushBody } from '../push';
import { findDedupResultId, maybeCleanupDedup, parseClientMutationId, recordDedup } from '../dedup';

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
register('POST', '/v1/conversations/:id/messages', async (req, env, ctx, params, authedUserId) => {
  if (!authedUserId) return fail(req, 'unauthorised', 401);
  const conversationId = parseUuid(params.id);
  if (!conversationId) return fail(req, 'invalid conversation id', 400);

  const body = await readJson<{ text?: unknown; clientMutationId?: unknown }>(req);
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

  // Idempotency: a retry of the same send (same clientMutationId from
  // this account) returns the originally-created message instead of
  // inserting a duplicate and re-firing realtime/push fan-out.
  const clientMutationId = parseClientMutationId(body.value.clientMutationId);
  if (clientMutationId) {
    const priorId = await findDedupResultId(env, authedUserId, clientMutationId);
    if (priorId) {
      const prior = await queryOne<{
        id: string;
        conversation_id: string;
        sender_id: string;
        text: string;
        created_at: string;
      }>(
        env,
        `SELECT id, conversation_id, sender_id, text, created_at
           FROM messages WHERE id = ? LIMIT 1`,
        [priorId],
      );
      if (prior) return ok(req, prior);
      // Mapping existed but the row is gone (e.g. deleted) — fall through
      // and create a fresh message rather than returning an empty body.
    }
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await exec(
    env,
    `INSERT INTO messages (id, conversation_id, sender_id, text, created_at) VALUES (?, ?, ?, ?, ?)`,
    [id, conversationId, authedUserId, text, now],
  );

  if (clientMutationId) {
    await recordDedup(env, authedUserId, clientMutationId, id);
    maybeCleanupDedup(env, ctx);
  }

  // The chat:<id> channel is published from the SENDER'S client (see
  // app/chat/[id].tsx) — both peers' chat-screen subscriptions get the
  // message in lock step and we don't double-publish here.
  //
  // What the sender's client CAN'T reach is a recipient who isn't on
  // the chat screen yet (e.g. the messages tab is open elsewhere, or
  // the app is backgrounded). For that we ping each OTHER participant
  // on their personal notifications channel so the messages-tab badge
  // and conversation row update without polling. Trim the preview hard
  // — the realtime payload should never carry a 16 KB chat body.
  const otherParticipants = await query<{ user_id: string }>(
    env,
    `SELECT user_id FROM conversation_participants
      WHERE conversation_id = ? AND user_id != ?`,
    [conversationId, authedUserId],
  );
  // Sender display info so the recipient's messages-tab row renders with a
  // name/emoji immediately — no extra `profiles` round-trip on their side.
  // One indexed PK lookup; cheap. (Previously the sender's client supplied
  // these via a client-side publish, which we removed because the client
  // token can't publish to a peer's notifications channel.)
  const sender = await queryOne<{ username: string; display_name: string; emoji: string }>(
    env,
    `SELECT username, display_name, emoji FROM profiles WHERE id = ?`,
    [authedUserId],
  );
  const preview = text.slice(0, 200);
  // Carry the FULL message (capped) alongside the badge preview. This is
  // the delivery backstop: a recipient whose chat screen ISN'T open (or who
  // never shared the `chat:<convId>` channel because the two peers entered
  // from different routes) still gets the whole message into their chat
  // store via RealtimeAccountBridge, deduped by `message_id`. The badge
  // keeps using `preview`. We cap the realtime `text` at 4 KB so the
  // WebSocket frame stays small — a longer body is rehydrated from the DB
  // on chat open.
  const realtimeText = text.length > 4096 ? text.slice(0, 4096) : text;
  for (const row of otherParticipants) {
    publishEvent(
      env,
      channels.userNotifications(row.user_id),
      'notif.message',
      {
        conversation_id: conversationId,
        sender_id: authedUserId,
        sender_name: sender?.display_name || '',
        sender_username: sender?.username || '',
        sender_emoji: sender?.emoji || '😊',
        message_id: id,
        text: realtimeText,
        created_at: now,
        preview,
        ts: now,
      },
      ctx,
    );
    // Off-screen / backgrounded recipients get a real push too. Clean the
    // body so storage markers (::gif::, ::re:: …) never leak into the banner.
    const pushBody = cleanPushBody(text).slice(0, 200);
    sendPushToUser(env, ctx, row.user_id, {
      title: sender?.display_name || sender?.username || 'New message',
      body: pushBody || 'New message',
      data: { type: 'message', conversation_id: conversationId, sender_id: authedUserId },
    });
  }

  return ok(req, {
    id,
    conversation_id: conversationId,
    sender_id: authedUserId,
    text,
    created_at: now,
  });
});
