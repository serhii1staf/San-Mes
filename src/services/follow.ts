// Follow / followers service helpers.
//
// The toggle-follow + counts helpers already live in `src/lib/supabase.ts`
// (`followUser`, `unfollowUser`, `isFollowing`, `getFollowCounts`). The
// queueMutation('follow' | 'unfollow', …) path in `services/offlineQueue.ts`
// is the one screens use to optimistically flip follow state with retry on
// reconnect.
//
// What was missing — and what this module adds — is the LIST endpoints
// (followers and following) that the new Followers / Following modal needs.
// They join the `follows` table against `profiles` so each row already
// carries everything the modal needs to render an Avatar + name + verified
// badge without a second round-trip per user.

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
  profiles: FollowProfileRow | FollowProfileRow[] | null;
}

// Supabase returns the joined `profiles` column as either an array (when the
// FK relation is many-to-many) or a single object — normalise to one shape.
function pickProfile(row: FollowsRow): FollowProfileRow | null {
  const p = row.profiles;
  if (!p) return null;
  if (Array.isArray(p)) return p[0] ?? null;
  return p;
}

/**
 * Fetch users who follow `userId`. Sorted by most-recent-follow first so
 * the modal's first page lands on whoever pressed the follow button last.
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
      .select(
        'follower_id, following_id, profiles:follower_id (id, username, display_name, emoji, bio, badge, is_verified)',
      )
      .eq('following_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) return { profiles: [], error: error.message };
    const rows = ((data || []) as unknown as FollowsRow[])
      .map(pickProfile)
      .filter((p): p is FollowProfileRow => !!p);
    return { profiles: rows, error: null };
  } catch (e: any) {
    return { profiles: [], error: e?.message || 'Unknown error' };
  }
}

/**
 * Fetch users that `userId` follows. Sorted newest-follow-first.
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
      .select(
        'follower_id, following_id, profiles:following_id (id, username, display_name, emoji, bio, badge, is_verified)',
      )
      .eq('follower_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) return { profiles: [], error: error.message };
    const rows = ((data || []) as unknown as FollowsRow[])
      .map(pickProfile)
      .filter((p): p is FollowProfileRow => !!p);
    return { profiles: rows, error: null };
  } catch (e: any) {
    return { profiles: [], error: e?.message || 'Unknown error' };
  }
}
