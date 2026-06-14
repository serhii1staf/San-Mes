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

import { supabase } from '../lib/supabase';

export interface FollowProfileRow {
  id: string;
  username: string;
  display_name: string;
  emoji: string | null;
  bio: string | null;
  badge: string | null;
  is_verified: boolean | null;
}

interface FollowsRow {
  follower_id: string;
  following_id: string;
  created_at?: string | null;
}

async function fetchProfilesByIds(ids: string[]): Promise<FollowProfileRow[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, display_name, emoji, bio, badge, is_verified')
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
    const { data, error } = await supabase
      .from('follows')
      .select('follower_id, following_id, created_at')
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
    const { data, error } = await supabase
      .from('follows')
      .select('follower_id, following_id, created_at')
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
