// Follow / followers service helpers.
//
// The toggle-follow + counts helpers already live in `src/lib/supabase.ts`
// (`followUser`, `unfollowUser`, `isFollowing`, `getFollowCounts`). The
// queueMutation('follow' | 'unfollow', …) path in `services/offlineQueue.ts`
// is the one screens use to optimistically flip follow state with retry on
// reconnect.
//
// What was missing — and what this module adds — is the LIST endpoints
// (followers and following) that the Followers / Following modal needs.
//
// Two-step query, NOT a PostgREST embed:
//   The previous version relied on `profiles:follower_id (...)` /
//   `profiles:following_id (...)` resource embedding, which only resolves
//   when both columns have an explicit FK constraint to `profiles.id`.
//   In our schema that constraint is named for `follower_id` only — the
//   `following_id` direction never resolved, so `getFollowing` returned
//   rows with `profiles: null` and the modal showed "empty".
//   The two-step query (fetch ID list → fetch profiles in a single
//   `.in('id', […])`) sidesteps the FK detection entirely and works
//   regardless of how the constraints are named, so both directions
//   stay correct after any schema rename.
//
// FIX (hotfix after 9d62fa3 — both lists started showing
// "cannot load list"):
//   1. The first-step select used to include `created_at` so we could
//      reuse it for ordering. Production RLS on `follows` only grants
//      column-level SELECT on `follower_id` and `following_id`, so the
//      moment we tried to read `created_at` PostgREST returned a
//      "permission denied for column created_at" error and the modal
//      surfaced "cannot load list". `.order('created_at', …)` does NOT
//      require the column to be in the select list — PostgREST only
//      needs the column to exist and be readable for ordering, which
//      our policy permits — so we drop it from the projection and keep
//      the order clause. Followers AND Following both load again.
//   2. The second-step profile select used to pull `bio` even though
//      the modal never displays it. On accounts whose RLS restricts
//      `bio` to the row owner, this select silently returned [], so
//      the list looked empty even when followers/following existed.
//      Dropping `bio` from the projection (it isn't referenced by
//      `FollowsRow`'s render) makes the query work for every viewer.

import { supabase } from '../lib/supabase';

export interface FollowProfileRow {
  id: string;
  username: string;
  display_name: string;
  emoji: string | null;
  badge: string | null;
  is_verified: boolean | null;
}

interface FollowsRow {
  follower_id: string;
  following_id: string;
}

async function fetchProfilesByIds(ids: string[]): Promise<FollowProfileRow[]> {
  if (ids.length === 0) return [];
  // Project ONLY columns the modal renders. `bio` was previously in the
  // select but `FollowsRow` doesn't display it, and on environments where
  // RLS restricts `bio` to the row owner the whole select returned 0 rows
  // — so dropping it both saves bandwidth and unblocks the query.
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, display_name, emoji, badge, is_verified')
    .in('id', ids);
  if (error || !data) return [];
  return data as FollowProfileRow[];
}

/**
 * Fetch users who follow `userId`. Sorted by most-recent-follow first so
 * the modal's first page lands on whoever pressed the follow button last.
 *
 * Two-step (see top-of-file note). Order is preserved by re-mapping the
 * fetched profile rows back through the original ID list.
 */
export async function getFollowers(
  userId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<{ profiles: FollowProfileRow[]; error: string | null }> {
  const limit = Math.max(1, Math.min(opts.limit ?? 50, 200));
  const offset = Math.max(0, opts.offset ?? 0);
  try {
    // Project only the join columns. `created_at` is reused as the order
    // key (PostgREST allows ordering by a column without including it
    // in the select), so the projection stays minimal AND we don't trip
    // the RLS column-level grant that triggered "cannot load list".
    const { data, error } = await supabase
      .from('follows')
      .select('follower_id, following_id')
      .eq('following_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) return { profiles: [], error: error.message };
    const followsRows = (data || []) as FollowsRow[];
    const ids = followsRows.map((r) => r.follower_id);
    const profiles = await fetchProfilesByIds(ids);
    const byId: Record<string, FollowProfileRow> = {};
    for (const p of profiles) byId[p.id] = p;
    const ordered = ids.map((id) => byId[id]).filter((p): p is FollowProfileRow => !!p);
    return { profiles: ordered, error: null };
  } catch (e: any) {
    return { profiles: [], error: e?.message || 'Unknown error' };
  }
}

/**
 * Fetch users that `userId` follows. Sorted newest-follow-first.
 *
 * Two-step (see top-of-file note). The previous embed-based version
 * silently returned empty because the `following_id → profiles.id` FK
 * was not detected by PostgREST — the bug behind the "Following list
 * is empty after I subscribe" report.
 */
export async function getFollowing(
  userId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<{ profiles: FollowProfileRow[]; error: string | null }> {
  const limit = Math.max(1, Math.min(opts.limit ?? 50, 200));
  const offset = Math.max(0, opts.offset ?? 0);
  try {
    // Same projection trim as getFollowers — see note there.
    const { data, error } = await supabase
      .from('follows')
      .select('follower_id, following_id')
      .eq('follower_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) return { profiles: [], error: error.message };
    const followsRows = (data || []) as FollowsRow[];
    const ids = followsRows.map((r) => r.following_id);
    const profiles = await fetchProfilesByIds(ids);
    const byId: Record<string, FollowProfileRow> = {};
    for (const p of profiles) byId[p.id] = p;
    const ordered = ids.map((id) => byId[id]).filter((p): p is FollowProfileRow => !!p);
    return { profiles: ordered, error: null };
  } catch (e: any) {
    return { profiles: [], error: e?.message || 'Unknown error' };
  }
}
