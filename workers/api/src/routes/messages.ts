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

/**
 * Validate one image dimension off the wire. Returns `null` for anything unusable.
 *
 * DROPPED, NOT REJECTED. These two numbers exist so a recipient can size a photo bubble before the
 * bytes arrive; they are presentation metadata, and the message is perfectly valid without them
 * (every message sent before migration 0006 has none). 400-ing a real message someone typed because
 * its width was reported as `0` — which `expo-image-manipulator` genuinely does for a file it failed
 * to read — would turn a cosmetic miss into a failed send. NULL simply means the receiver measures
 * on load, exactly as it does today.
 *
 * The upper bound is a sanity rail, not a policy: `fitChatImageBox` only consumes the RATIO, so a
 * nonsense pair cannot make a bubble huge, but it can make one absurdly thin. 20000 is comfortably
 * above any real camera (a 100MP sensor is ~11600 on its long edge) while keeping the stored value
 * in a range where `w / h` stays meaningful.
 */
function parseImageDim(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const n = Math.round(v);
  if (n <= 0 || n > 20000) return null;
  return n;
}

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

  const body = await readJson<{ text?: unknown; clientMutationId?: unknown; imgW?: unknown; imgH?: unknown }>(req);
  if (!body.ok) return fail(req, body.error, 400);
  // 5000, matching `MAX_MESSAGE_CHARS` in src/utils/textLimits.ts, which the composer enforces
  // with `maxLength`. This was 16000 — over three times the client's cap, so the server's limit
  // was not a limit at all for any message the app can produce, and a non-app client could
  // store a message no screen in the app is built to render. The two numbers are a contract;
  // keep them equal.
  const text = typeof body.value.text === 'string' ? body.value.text.slice(0, 5000) : '';
  if (!text) return fail(req, 'empty message', 400);
  // Pixel dimensions of the first attached image (migration 0006). See `parseImageDim` for why a
  // bad value is dropped rather than rejected.
  const imgW = parseImageDim(body.value.imgW);
  const imgH = parseImageDim(body.value.imgH);

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
        img_w: number | null;
        img_h: number | null;
        created_at: string;
      }>(
        env,
        `SELECT id, conversation_id, sender_id, text, img_w, img_h, created_at
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
    `INSERT INTO messages (id, conversation_id, sender_id, text, img_w, img_h, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, conversationId, authedUserId, text, imgW, imgH, now],
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
        // Carried on THIS payload as well as in the history response, because this is the path a
        // recipient who is not on the chat screen takes: `RealtimeAccountBridge` decodes the
        // `::img::` marker out of `text` and writes the message straight into the chat store, so by
        // the time that person opens the chat the bubble renders from a row that never went through
        // a history fetch. Without the dimensions here, the one photo most likely to be looked at
        // immediately — the one that just arrived — would be the one that still resizes on decode.
        img_w: imgW,
        img_h: imgH,
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
    img_w: imgW,
    img_h: imgH,
    created_at: now,
  });
});

// ── DELETE /v1/messages/:id ───────────────────────────────────────────
//
// THIS ROUTE DID NOT EXIST, AND THAT WAS THE BUG.
//
// Reported as: delete a message, wait a second or two, and it comes back — for the person who
// deleted it and for the peer, every time.
//
// "Delete" on the client was two purely local acts: filter the row out of the in-memory array,
// and publish `msg.delete` on `chat:<id>` so the peer filters it out of theirs. Nothing ever
// removed the row from D1. That was invisible for as long as nothing re-read the server's
// copy, and it stopped being invisible the moment the chat screen began polling
// `GET /v1/conversations/:id/messages` every six seconds: the poll returned the row, the merge
// saw an id it did not have locally, and added it back. Both devices poll, so both resurrected
// it independently.
//
// Authorisation is SENDER-ONLY, deliberately narrower than "any participant". Deleting a
// message removes it for everybody in the conversation (that is what the realtime event does),
// so allowing a recipient to do it would let one participant destroy another's messages. If
// "delete for me only" is ever wanted it is a different feature with different storage, not a
// wider permission on this one.
//
// Hard DELETE rather than a `deleted_at` flag. The table has no such column, and adding one
// would mean every read path in the app has to remember to filter it — a fine design when
// deleted content must be recoverable or auditable, and unnecessary weight when it must not
// be. If moderation ever needs recoverable deletes, that is a schema migration plus a filter
// in every SELECT, and it should be done deliberately rather than implied by this route.
//
// The realtime publish is the SAME event and channel the client already publishes, so peers
// need no new handler: `msg.delete` on `chat:<conversationId>`. It is published server-side as
// well as client-side because the client's publish depends on the deleter's socket being
// connected at that instant, and this one does not.
register('DELETE', '/v1/messages/:id', async (req, env, ctx, params, authedUserId) => {
  if (!authedUserId) return fail(req, 'unauthorised', 401);
  const id = parseUuid(params.id);
  if (!id) return fail(req, 'invalid message id', 400);

  // One lookup gets both the authorisation subject and the channel to publish on.
  const row = await queryOne<{ sender_id: string; conversation_id: string }>(
    env,
    `SELECT sender_id, conversation_id FROM messages WHERE id = ? LIMIT 1`,
    [id],
  );
  // Already gone. Idempotent on purpose: the client retries this on a flaky connection, and a
  // second delete of the same message is a success, not an error.
  if (!row) return ok(req, { deleted: true });
  if (row.sender_id !== authedUserId) return fail(req, 'forbidden', 403);

  await exec(env, `DELETE FROM messages WHERE id = ?`, [id]);

  publishEvent(
    env,
    channels.chat(row.conversation_id),
    'msg.delete',
    { id, conversation_id: row.conversation_id },
    ctx,
  );

  return ok(req, { deleted: true });
});

// ── PATCH /v1/messages/:id ────────────────────────────────────────────
//
// THIS ROUTE DID NOT EXIST EITHER, AND IT IS THE SAME BUG AS DELETE WAS.
//
// Reported as: "editing does not work anywhere — I edit and the old message stays."
//
// Editing was two purely local acts: rewrite the row in the in-memory array, and publish
// `msg.edit` on `chat:<id>` so the peer rewrites theirs. Nothing ever updated D1. The server
// kept the original text for ever, so the edit survived exactly as long as the array holding
// it: reopen the chat, open it on another device, or let the history poll refill from the
// server, and the old text was back. Comments and posts both have a PATCH route
// (`/v1/comments/:id`, `/v1/posts/:id`); messages were the one content type without one.
//
// Sender-only, for the same reason as DELETE: an edit rewrites the message for everybody in
// the conversation, so letting a recipient do it would let one participant put words in
// another's mouth.
//
// The text cap matches MAX_MESSAGE_CHARS (5000) and the create path, so an edit cannot be used
// to exceed a limit the composer enforces.
//
// Publishes the SAME event and channel the client already publishes — `msg.edit` on
// `chat:<conversationId>` — so peers need no new handler. Published server-side as well as
// client-side because the client's publish depends on the editor's socket being connected at
// that instant, and this one does not.
//
// Deliberately NOT touching `created_at`: an edit is not a new message, and moving its
// timestamp would reorder the transcript and move the conversation in the chat list.
register('PATCH', '/v1/messages/:id', async (req, env, ctx, params, authedUserId) => {
  if (!authedUserId) return fail(req, 'unauthorised', 401);
  const id = parseUuid(params.id);
  if (!id) return fail(req, 'invalid message id', 400);

  const body = await readJson<{ text?: unknown; imgW?: unknown; imgH?: unknown }>(req);
  if (!body.ok) return fail(req, body.error, 400);
  const text = typeof body.value.text === 'string' ? body.value.text.slice(0, 5000) : null;
  // An edit can change which images are attached — removing a photo from a multi-image message is
  // done through this route — so the dimensions have to be able to change with them, including back
  // to NULL when the last image goes. Written unconditionally alongside `text` rather than only when
  // present, because "the client did not send dimensions" and "this message no longer has an image"
  // must produce the same stored state; a COALESCE here would leave a deleted photo's shape behind to
  // size whatever image was attached next.
  const imgW = parseImageDim(body.value.imgW);
  const imgH = parseImageDim(body.value.imgH);
  // An empty edit is a delete, and delete has its own route with its own semantics (it
  // publishes `msg.delete`, which peers handle by removing the row). Silently turning one into
  // the other here would make the peer's UI disagree with the database.
  if (text === null) return fail(req, 'text required', 400);

  const row = await queryOne<{ sender_id: string; conversation_id: string }>(
    env,
    `SELECT sender_id, conversation_id FROM messages WHERE id = ? LIMIT 1`,
    [id],
  );
  if (!row) return fail(req, 'not found', 404);
  if (row.sender_id !== authedUserId) return fail(req, 'forbidden', 403);

  await exec(env, `UPDATE messages SET text = ?, img_w = ?, img_h = ? WHERE id = ?`, [text, imgW, imgH, id]);

  publishEvent(
    env,
    channels.chat(row.conversation_id),
    'msg.edit',
    { id, text, img_w: imgW, img_h: imgH, conversation_id: row.conversation_id },
    ctx,
  );

  return ok(req, { id, text, img_w: imgW, img_h: imgH });
});

// ── POST /v1/messages/dims ────────────────────────────────────────────
//
// Body: { items: [{ id, w, h }] } → { updated: <count> }
//
// Backfill image dimensions for messages that predate migration 0006, reported by whoever first
// decoded the photo.
//
// WHY THIS EXISTS AT ALL
//
// 0006 makes every NEW message carry its photo's shape, which is what stops the bubble resizing on
// decode. It cannot do anything for messages already in the table: the server never saw those images.
// On the live database that is 286 image-bearing messages out of 980 — and those are precisely the
// ones the report is about, because the symptom appears while scrolling UP through history. A fix
// that only covered future messages would have left the reported case exactly as it was.
//
// WHY TRUSTING THE READER'S MEASUREMENT IS SAFE
//
// The client's own `SingleChatImage.handleLoad` already measures the photo on first decode and writes
// the result into its local, permanent `imageDimsCache`. So this number is not new or less trusted —
// it is the number that device has been sizing every subsequent view from all along. If it were
// wrong (the EXIF-transpose hazard the client's comments warn about), every second view of that photo
// would show a permanently wrong box rather than a one-time settle, and the report says settle.
//
// It is measured off the weserv-proxied derivative rather than the original, which does not matter:
// the only consumer is `fitChatImageBox`, and that reads the RATIO. A proportional resize preserves it.
//
// WRITE-ONCE, AND THAT IS THE WHOLE SECURITY MODEL
//
// `AND img_w IS NULL` means this can only ever fill a hole. It cannot overwrite what a sender sent,
// it cannot be replayed to change a shape later, and a second reader racing the first is a harmless
// no-op. So the worst a malicious participant can do is put a wrong aspect ratio on an unmeasured
// photo in a conversation they are already in — a cosmetic box on their own screen and their peer's,
// self-limited to one message, and not something that can be escalated or repeated.
//
// Authorisation is folded into each statement as an EXISTS over `conversation_participants` rather
// than checked up front, because the items in one batch may span conversations. One statement can
// then be both the permission check and the write, so there is no window between them and no way for
// a partially-authorised batch to apply the unauthorised half.
//
// BATCHED because the trigger is scrolling: a first pass through a media-heavy history decodes many
// photos in quick succession, and one request per photo would put a burst of writes behind a scroll.
// The client buffers and flushes; this caps a batch at 50 so a single call stays bounded.
//
// Registered before nothing it could collide with: the router matches per method, and `dims` is the
// only POST under `/v1/messages/`.
register('POST', '/v1/messages/dims', async (req, env, _ctx, _params, authedUserId) => {
  if (!authedUserId) return fail(req, 'unauthorised', 401);
  const body = await readJson<{ items?: unknown }>(req);
  if (!body.ok) return fail(req, body.error, 400);
  const raw = Array.isArray(body.value.items) ? body.value.items : null;
  if (!raw || raw.length === 0) return fail(req, 'items required', 400);

  const statements: { sql: string; params: unknown[] }[] = [];
  for (const it of raw.slice(0, 50)) {
    if (!it || typeof it !== 'object') continue;
    const rec = it as { id?: unknown; w?: unknown; h?: unknown };
    const id = parseUuid(typeof rec.id === 'string' ? rec.id : '');
    const w = parseImageDim(rec.w);
    const h = parseImageDim(rec.h);
    // A locally-created id (`m-<timestamp>`) is not a uuid and fails `parseUuid` — those messages are
    // not on the server yet and have nothing to backfill.
    if (!id || w === null || h === null) continue;
    statements.push({
      sql: `UPDATE messages
               SET img_w = ?, img_h = ?
             WHERE id = ?
               AND img_w IS NULL
               AND EXISTS (SELECT 1 FROM conversation_participants cp
                            WHERE cp.conversation_id = messages.conversation_id
                              AND cp.user_id = ?)`,
      params: [w, h, id, authedUserId],
    });
  }
  if (statements.length === 0) return ok(req, { updated: 0 });

  await batch(env, statements);
  // Reports the number of statements RUN, not rows changed: `batch` does not surface per-statement
  // `meta.changes` in a shape worth threading through, and the client does not branch on it — it is a
  // fire-and-forget backfill. Anything already filled in was a no-op by design.
  return ok(req, { updated: statements.length });
});
