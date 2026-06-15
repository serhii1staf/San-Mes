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
  }

  // Find every conversation the user is in, then re-join
  // conversation_participants to fetch the OTHER participant's row, then
  // join profiles for that participant's display info.
  const rows = await query<Row>(
    env,
    `SELECT cp.conversation_id                 AS conversation_id,
            c.id                               AS conv_id,
            c.created_at                       AS conv_created_at,
            other.user_id                      AS other_id,
            pr.username                        AS other_username,
            pr.display_name                    AS other_display_name,
            pr.emoji                           AS other_emoji,
            pr.is_verified                     AS other_is_verified,
            pr.badge                           AS other_badge
       FROM conversation_participants cp
       JOIN conversations c
         ON c.id = cp.conversation_id
       JOIN conversation_participants other
         ON other.conversation_id = cp.conversation_id
        AND other.user_id != cp.user_id
  LEFT JOIN profiles pr ON pr.id = other.user_id
      WHERE cp.user_id = ?
   ORDER BY c.created_at DESC`,
    [authedUserId],
  );

  const out = rows.map((row) => ({
    conversation_id: row.conversation_id,
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

  const rows = await query<{
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
   ORDER BY created_at ASC
      LIMIT ?`,
    [conversationId, limit],
  );
  return ok(req, rows);
});
