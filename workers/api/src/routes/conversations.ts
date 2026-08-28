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
import { normalizeProfile, query, queryOne } from '../db';
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
              ORDER BY m.created_at DESC LIMIT 1)  AS last_message
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
