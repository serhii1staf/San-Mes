// Follow / followers list helpers.
//
// Phase 5 of the Cloudflare D1 migration: both directions resolve
// through a single Worker endpoint that does the JOIN server-side.
// The two-step Supabase-PostgREST workaround documented in the
// previous version of this file is gone — D1 has explicit FKs we
// control, and the Worker's `LEFT JOIN profiles ON pr.id = ?_id`
// returns the embedded shape directly.
//
// Caller contract is unchanged: `{ profiles: FollowProfileRow[]; error }`.

import { apiGet } from './apiClient';

export interface FollowProfileRow {
  id: string;
  username: string;
  display_name: string;
  emoji: string | null;
  badge: string | null;
  is_verified: boolean | null;
}

/** Fetch users who follow `userId`. Newest-follow first. */
export async function getFollowers(
  userId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<{ profiles: FollowProfileRow[]; error: string | null }> {
  const limit = Math.max(1, Math.min(opts.limit ?? 50, 200));
  const offset = Math.max(0, opts.offset ?? 0);
  const { data, error } = await apiGet<FollowProfileRow[]>(
    `/v1/profiles/${encodeURIComponent(userId)}/followers?limit=${limit}&offset=${offset}`,
  );
  if (error) return { profiles: [], error };
  return { profiles: data || [], error: null };
}

/** Fetch users that `userId` follows. Newest-follow first. */
export async function getFollowing(
  userId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<{ profiles: FollowProfileRow[]; error: string | null }> {
  const limit = Math.max(1, Math.min(opts.limit ?? 50, 200));
  const offset = Math.max(0, opts.offset ?? 0);
  const { data, error } = await apiGet<FollowProfileRow[]>(
    `/v1/profiles/${encodeURIComponent(userId)}/following?limit=${limit}&offset=${offset}`,
  );
  if (error) return { profiles: [], error };
  return { profiles: data || [], error: null };
}
