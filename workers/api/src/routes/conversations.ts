// Conversations endpoints.
//
// Both endpoints are authed-only — there's no anonymous view of a
// chat. The Worker verifies the bearer token in the central
// dispatcher and passes `authedUserId` through; if it's null we 401
// immediately rather than serving anonymous content.
//
// `GET /v1/conversations` mirrors the existing `getConversations(userId)`
// shape, which is awkward because the source query reaches THROUGH
// conversation_participants to surface the OTHER participant's profile
// alongside the conversation row. The shape matters: callers expect
// `{ conversation_id, conversations: { id, created_at }, profiles: { … } }`.
//
// `GET /v1/conversations/:id/messages` requires the authed user to be
// a participant — the previous Supabase RLS-based protection doesn't
// exist in D1, so we enforce it in-handler with a small `EXISTS` check.

import { fail, ok } from '../http';
import { register } from '../router';
import { exec, normalizeProfile, query, queryOne } from '../db';
import { parseLimit, parseUuid } from '../util';

/**
 * Cap on how many conversations one sync returns.
 *
 * Set well above any realistic chat list so no user loses a conversation from the
 * list, while still bounding the query: without a LIMIT this endpoint's result set —
 * and the D1 rows it reads — grew linearly and without ceiling for the heaviest
 * users, on a metered daily row-read budget. Ordered newest-first, so if anyone ever
 * exceeds this, what falls off the end is their least recently active chats.
 */
const CONVERSATIONS_PAGE_LIMIT = 500;

// ── GET /v1/conversations ─────────────────────────────────────────────
//
// Lists every conversation the authed user participates in, projected
// as one row per OTHER participant (matching the Supabase shape, which
// queried `conversation_participants` filtered by `.neq('user_id', me)`
// and embedded `conversations` + `profiles`).
//
// SQLite quirk noted: the Supabase response embeds returned an array
// per row when multiple matches existed (`Array.isArray(p.posts)` in
// `getLikedPosts`). Conversations are 1:1 in this app so the embed
// always collapses to a single row — we shape it as a single object,
// not an array, which matches what the UI actually consumes.
register('GET', '/v1/conversations', async (req, env, _ctx, _params, authedUserId) => {
  if (!authedUserId) return fail(req, 'unauthorised', 401);

  interface Row {
    conversation_id: string;
    conv_id: string;
    conv_created_at: string;
    other_id: string;
    other_username: string;
    other_display_name: string;
    other_emoji: string | null;
    other_is_verified: number | null;
    other_badge: string | null;
    last_message_at: string | null;
    last_sender_id: string | null;
    last_message: string | null;
    unread_count: number | null;
  }

  // Find every conversation the user is in, then re-join
  // conversation_participants to fetch the OTHER participant's row, then
  // join profiles for that participant's display info.
  const rows = await query<Row>(
    env,
    // ── THE LIST MUST CARRY ITS LAST MESSAGE ────────────────────────────────
    //
    // Reported five times: the app is closed, messages arrive, the app is opened, and neither the
    // chat-list row badge nor the bottom-bar counter shows anything.
    //
    // This query is the reason, and it took three attempts on the client to find it. The client's
    // `reconcile` decides "unread" by comparing each row's newest-message time against a persisted
    // read watermark, and its first line is `if (!r?.id || !r.lastMessageAt) continue;`. This response
    // carried no timestamp at all, so EVERY row was skipped and no count could ever be raised —
    // regardless of when the pass ran or which user id it ran under. Two client-side fixes changed the
    // timing of a call whose input was empty by construction.
    //
    // `last_message_at` / `last_sender_id` / `last_message` close that. They also fix a second thing
    // the client was working around locally: `syncConversations` rebuilds every row from participant
    // fields and `setConversations` replaces the array wholesale, so any timestamp the realtime bridge
    // had written onto a row was wiped every few minutes. Now the server is the source for it.
    //
    // No migration. `messages` already has `sender_id`, `created_at` and `text` — the sibling route in
    // this same file selects exactly those columns — so this is a read-only change plus a deploy, which
    // deliberately avoids the D1 migration permission problem that pushed unread counting onto the
    // client in the first place.
    //
    // Shape: a correlated subquery per conversation rather than a GROUP BY join, because the newest
    // row's AUTHOR is needed alongside its timestamp and `MAX(created_at)` with a bare `sender_id`
    // would be a bare-column select — SQLite permits it for a simple `MAX` aggregate but it is
    // fragile, and the client's whole author guard depends on the two describing the SAME message.
    // `idx_messages_conversation` makes each subquery a single index seek.
    //
    // ORDER BY is now last activity, falling back to creation for a conversation with no messages.
    // That is a free correctness win: the list is recency-ordered on the client anyway, so the old
    // `c.created_at DESC` meant the LIMIT could cut off the most recently active conversations.
    //
    // ── `unread_count`: HOW MANY, NOT WHETHER ───────────────────────────────────────────────
    //
    // The three `last_*` subqueries answer "is there anything new". They cannot answer "how
    // many", which is the whole reason `chatUnreadStore.reconcile` on the client could only ever
    // write the literal `1` for a conversation this device had not personally witnessed over the
    // realtime socket. Counting happens here because this is the only place that holds both the
    // watermark (`cp.last_read_at`, migration 0005) and the messages.
    //
    // `m.sender_id != cp.user_id` — my own messages are never unread to me. That guard used to
    // live on the client as `lastSenderId === myUserId`, comparing against a field that
    // routinely described a DIFFERENT message than the timestamp sitting beside it; see the long
    // note in `reconcile` for the four failed attempts that came out of it. Here both facts are
    // read off one row, so the mismatch is not possible rather than defended against.
    //
    // BOUNDED AT 100 ROWS READ, and the inner LIMIT is load-bearing. D1 bills rows read, and an
    // uncapped `COUNT(*)` over an abandoned conversation holding 10k unread messages reads 10k
    // rows on every chat-list sync — for a number the pill renders as "99+" either way. The
    // client caps display at 99, so any value at or above 100 is display-identical; this reads
    // at most 100 rows per conversation and stops. That matters here specifically because this
    // endpoint already fans out to `CONVERSATIONS_PAGE_LIMIT` (500) rows per call.
    //
    // Served by `idx_messages_conv_created (conversation_id, created_at)`, which already exists —
    // verified present on the live database before migration 0005 was written. The watermark
    // comparison is a range scan from the watermark forward, not a scan of the conversation.
    `SELECT cp.conversation_id                 AS conversation_id,
            c.id                               AS conv_id,
            c.created_at                       AS conv_created_at,
            other.user_id                      AS other_id,
            pr.username                        AS other_username,
            pr.display_name                    AS other_display_name,
            pr.emoji                           AS other_emoji,
            pr.is_verified                     AS other_is_verified,
            pr.badge                           AS other_badge,
            (SELECT m.created_at FROM messages m
              WHERE m.conversation_id = c.id
              ORDER BY m.created_at DESC LIMIT 1)  AS last_message_at,
            (SELECT m.sender_id  FROM messages m
              WHERE m.conversation_id = c.id
              ORDER BY m.created_at DESC LIMIT 1)  AS last_sender_id,
            (SELECT m.text       FROM messages m
              WHERE m.conversation_id = c.id
              ORDER BY m.created_at DESC LIMIT 1)  AS last_message,
            -- Unread for THIS participant. See the note above the query for why the inner
            -- LIMIT is load-bearing rather than cosmetic.
            (SELECT COUNT(*) FROM (
               SELECT 1 FROM messages m
                WHERE m.conversation_id = c.id
                  AND m.sender_id != cp.user_id
                  AND (cp.last_read_at IS NULL OR m.created_at > cp.last_read_at)
                LIMIT 100))                        AS unread_count
       FROM conversation_participants cp
       JOIN conversations c
         ON c.id = cp.conversation_id
       JOIN conversation_participants other
         ON other.conversation_id = cp.conversation_id
        AND other.user_id != cp.user_id
  LEFT JOIN profiles pr ON pr.id = other.user_id
      WHERE cp.user_id = ?
   ORDER BY COALESCE((SELECT m.created_at FROM messages m
                       WHERE m.conversation_id = c.id
                       ORDER BY m.created_at DESC LIMIT 1), c.created_at) DESC
      LIMIT ?`,
    // Bounded. This query had NO limit, so it returned every conversation the user
    // has ever had, joined three ways, on every chat-list sync — the result set (and
    // the D1 rows read) grew without ceiling for the app's heaviest users. The chat
    // list is recency-ordered and the client caches locally, so a generous cap costs
    // nothing anyone would notice while making the worst case finite.
    [authedUserId, CONVERSATIONS_PAGE_LIMIT],
  );

  const out = rows.map((row) => ({
    conversation_id: row.conversation_id,
    // Emitted at the TOP level, not inside `conversations`, because the client's mapper reads
    // `c.conversations` for the id and treats the rest of the envelope as row-level fields. Nulls are
    // passed through rather than defaulted: the client distinguishes "no last message" from "a last
    // message with an empty body", and an empty string for a photo-only message is meaningful.
    last_message_at: row.last_message_at,
    last_sender_id: row.last_sender_id,
    last_message: row.last_message,
    // Defaulted to 0 rather than passed through as null: unlike `last_message`, where "no last
    // message" and "an empty body" are genuinely different states the client distinguishes,
    // there is no meaningful difference between "no unread" and "unknown unread" — both render
    // as no pill. A number always is one less branch on the client.
    unread_count: typeof row.unread_count === 'number' ? row.unread_count : 0,
    conversations: {
      id: row.conv_id,
      created_at: row.conv_created_at,
    },
    profiles: row.other_id
      ? normalizeProfile({
          id: row.other_id,
          username: row.other_username,
          display_name: row.other_display_name,
          emoji: row.other_emoji,
          is_verified: row.other_is_verified,
          badge: row.other_badge,
          links: null,
        })
      : null,
  }));
  return ok(req, out);
});

// ── POST /v1/conversations/:id/read ───────────────────────────────────
//
// Advance the caller's read watermark for one conversation.
//
// WHY THIS ENDPOINT HAS TO EXIST
//
// Before it, "read" was a `Date.now()` written into per-install MMKV by
// `chatUnreadStore.clear`. That has two consequences the user reported as separate bugs and
// which are really one:
//
//   * it is not shared. Read a chat on the phone, the tablet still shows it unread, for ever.
//     Reinstall, and every conversation is unread again because the watermark map went with the
//     old install.
//   * it is on the WRONG CLOCK. The watermark came from the device and was compared against
//     `messages.created_at`, which the Worker writes. Any skew between the two — and there is
//     always some — decides whether a message you have already read counts as unread. That
//     skew is the reason a whole layer of author-guards had to be bolted onto `reconcile`.
//
// Storing the watermark next to the messages puts both values on one clock and makes the
// answer the same on every device the account signs into.
//
// MONOTONIC BY CONSTRUCTION
//
// The `last_read_at < ?` guard in the WHERE clause is what makes this endpoint safe to call
// from anywhere, in any order. The client fires it on chat open, on foreground, on leave and on
// send — four call sites whose responses can arrive out of order over a slow network. Without
// the guard, a stale in-flight request could move the watermark BACKWARDS and resurrect unread
// counts for messages the user has read. With it, a late arrival is a no-op. This is the same
// reason `clear()` on the client always advances and never assigns.
//
// THE TIMESTAMP IS THE SERVER'S, AND THE REQUEST BODY CANNOT INFLUENCE IT.
//
// The first version of this endpoint accepted an optional `at` from the client, clamped to "not in
// the future", on the reasoning that a client might want to mark read up to the newest message it
// had actually rendered. Caught in end-to-end verification against the live database: the Android
// emulator's clock was 3h34m BEHIND real time, the client sent `new Date().toISOString()`, and the
// watermark landed three and a half hours in the past. Every message from those hours would have
// counted as unread again the moment the chat list synced — which is the exact bug this whole change
// exists to fix, reintroduced by the fix, on any device with a skewed clock.
//
// That also directly contradicted the rationale in migration 0005: the point of moving read state
// onto the server was to put the watermark and `messages.created_at` on ONE clock. A client-supplied
// timestamp gives that away for nothing, because the client's clock is exactly the thing we stopped
// trusting.
//
// So there is no `at` parameter. Marking read means "as of when the server processed this", which is
// the only value that is guaranteed comparable with the rows it will be compared against. A future
// "mark read up to message X" feature should pass a MESSAGE ID and let the server look up that
// message's own `created_at` — never a caller-supplied time.
register('POST', '/v1/conversations/:id/read', async (req, env, _ctx, params, authedUserId) => {
  if (!authedUserId) return fail(req, 'unauthorised', 401);
  const conversationId = parseUuid(params.id);
  if (!conversationId) return fail(req, 'invalid conversation id', 400);

  const at = new Date().toISOString();

  // Explicit participation check, its own round-trip, for the same reason the messages
  // endpoint below does it that way. It also cannot be folded into the UPDATE: `meta.changes`
  // is 0 both for "you are not in this conversation" and for "your watermark is already ahead
  // of this timestamp", and those must not return the same status.
  const participant = await queryOne<{ x: number }>(
    env,
    `SELECT 1 AS x
       FROM conversation_participants
      WHERE conversation_id = ?
        AND user_id = ?
      LIMIT 1`,
    [conversationId, authedUserId],
  );
  if (!participant) return fail(req, 'forbidden', 403);

  await exec(
    env,
    `UPDATE conversation_participants
        SET last_read_at = ?
      WHERE conversation_id = ?
        AND user_id = ?
        AND (last_read_at IS NULL OR last_read_at < ?)`,
    [at, conversationId, authedUserId, at],
  );

  // Return the watermark that is now in force and what is still unread beneath it. If the
  // monotonic guard above declined to move it — because a later request already got there — the
  // caller learns the real value instead of assuming its own. `unread` lets a client settle its
  // badge from this response without waiting for the next list sync.
  const state = await queryOne<{ last_read_at: string | null; unread: number }>(
    env,
    `SELECT cp.last_read_at AS last_read_at,
            (SELECT COUNT(*) FROM (
               SELECT 1 FROM messages m
                WHERE m.conversation_id = cp.conversation_id
                  AND m.sender_id != cp.user_id
                  AND (cp.last_read_at IS NULL OR m.created_at > cp.last_read_at)
                LIMIT 100)) AS unread
       FROM conversation_participants cp
      WHERE cp.conversation_id = ?
        AND cp.user_id = ?
      LIMIT 1`,
    [conversationId, authedUserId],
  );

  return ok(req, {
    conversation_id: conversationId,
    last_read_at: state?.last_read_at ?? at,
    unread_count: typeof state?.unread === 'number' ? state.unread : 0,
  });
});

// ── GET /v1/conversations/:id/messages?limit=50 ───────────────────────
//
// Messages within a conversation, oldest-first (matches the existing
// `.order('created_at', { ascending: true })` in supabase.ts). Requires
// the authed user to be a participant — otherwise 403.
register('GET', '/v1/conversations/:id/messages', async (req, env, _ctx, params, authedUserId) => {
  if (!authedUserId) return fail(req, 'unauthorised', 401);
  const conversationId = parseUuid(params.id);
  if (!conversationId) return fail(req, 'invalid conversation id', 400);

  const url = new URL(req.url);
  const limit = parseLimit(url.searchParams.get('limit'), 200, 50);

  // Participation check is its own round-trip rather than a JOIN-with-
  // EXISTS clause because D1 keeps the planner happy with a flat index
  // hit on `idx_cp_user_id` followed by a flat scan on the messages
  // index — both single-key lookups, no merge sort.
  const participant = await queryOne<{ x: number }>(
    env,
    `SELECT 1 AS x
       FROM conversation_participants
      WHERE conversation_id = ?
        AND user_id = ?
      LIMIT 1`,
    [conversationId, authedUserId],
  );
  if (!participant) return fail(req, 'forbidden', 403);

  // ── NEWEST N, NOT OLDEST N ──────────────────────────────────────────────
  //
  // This was `ORDER BY created_at ASC LIMIT ?`, which returns the OLDEST rows in the
  // conversation. For a chat that is the wrong end: a client opening a conversation wants
  // what was said recently, and on any conversation longer than `limit` this endpoint could
  // never return the newest message at all.
  //
  // It also had a visible cost on the client. The chat screen seeds from a local cache of the
  // newest messages and then fetches here, so the response arrived as a block of ancient
  // history that got merged IN FRONT of everything on screen — a large prepend a second after
  // the chat painted, which is what the "messages vanish, come back, and the view is yanked
  // up and down" report was. The client now defends itself by dropping rows older than what it
  // holds, but that is a workaround for this query being backwards.
  //
  // `DESC` + reverse gives the newest `limit` rows in chronological order, which is what the
  // response contract has always claimed (oldest-first) and what every caller assumes.
  //
  // ── ?since=<iso8601> ────────────────────────────────────────────────────
  //
  // The client polls this every six seconds while a chat is open. Without a cursor, an idle
  // conversation transfers its whole tail on every tick forever — the client merges it,
  // finds nothing new, and discards it. With `since` an idle poll transfers an empty array.
  //
  // `since` is compared as a STRING, which is correct for ISO-8601 in the fixed-width,
  // zero-padded, UTC form this app stores everywhere (it sorts identically under
  // lexicographic and chronological comparison). Anything not matching that shape is ignored
  // rather than rejected, so a malformed cursor degrades to a normal fetch instead of a 400
  // that would leave the client with no way to catch up.
  //
  // Strictly greater than, so passing the newest known `created_at` back does not re-fetch
  // that row. Ties within the same millisecond are possible in principle; the client's merge
  // dedupes on id, so a missed simultaneous message is recovered by the next full fetch.
  const sinceRaw = url.searchParams.get('since');
  const since = sinceRaw && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z?$/.test(sinceRaw) ? sinceRaw : null;

  const rows = since
    ? await query<{
        id: string;
        conversation_id: string;
        sender_id: string;
        text: string;
        created_at: string;
      }>(
        env,
        `SELECT id, conversation_id, sender_id, text, created_at
           FROM messages
          WHERE conversation_id = ?
            AND created_at > ?
       ORDER BY created_at ASC
          LIMIT ?`,
        [conversationId, since, limit],
      )
    : await query<{
        id: string;
        conversation_id: string;
        sender_id: string;
        text: string;
        created_at: string;
      }>(
        env,
        `SELECT id, conversation_id, sender_id, text, created_at
           FROM messages
          WHERE conversation_id = ?
       ORDER BY created_at DESC
          LIMIT ?`,
        [conversationId, limit],
      );

  // The `since` branch is already ascending — it takes everything after a cursor, so the limit
  // bites at the NEWEST end and reversing would be wrong. The unfiltered branch selected
  // descending to get the newest rows, so it needs flipping back into the contract's order.
  if (!since) rows.reverse();

  return ok(req, rows);
});
