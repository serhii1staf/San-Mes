// GET /v1/feed?limit=20&offset=0
//
// Replaces the home-feed read (`getPosts(limit, offset)` in
// `src/lib/supabase.ts`). Returns the most recent posts with their
// author profile JOINed in — the `profiles:author_id (…)` embed shape
// is preserved verbatim so the existing feed-render code paths don't
// need to know which data source produced the rows.
//
// Defaults & clamps:
//   limit  ∈ [1, 50]   default 20  (matches Phase 1.5 page-size cut)
//   offset ∈ [0, ∞)    default 0
// Anything malformed is silently coerced via `parseLimit` / `parseOffset`
// rather than 400'd, because the app fires this on every cold-open and
// we want broken cache entries to recover instead of fail visibly.

import { ok } from '../http';
import { register } from '../router';
import { normalizeProfile, query } from '../db';
import { parseLimit, parseOffset } from '../util';

interface FeedRow {
  id: string;
  author_id: string;
  content: string;
  image_url: string | null;
  likes_count: number;
  comments_count: number;
  shares_count: number;
  created_at: string;
  profile_id: string | null;
  profile_username: string | null;
  profile_display_name: string | null;
  profile_emoji: string | null;
  profile_badge: string | null;
  profile_is_verified: number | null;
}

register('GET', '/v1/feed', async (req, env) => {
  const url = new URL(req.url);
  const limit = parseLimit(url.searchParams.get('limit'), 50, 20);
  const offset = parseOffset(url.searchParams.get('offset'));

  // Composite index `idx_posts_created_at (created_at DESC)` covers the
  // ORDER BY; the LEFT JOIN onto profiles is by primary key. Phase-2
  // load is single-digit-ms even on cold isolates per local benches.
  const rows = await query<FeedRow>(
    env,
    `SELECT p.id,
            p.author_id,
            p.content,
            p.image_url,
            p.likes_count,
            p.comments_count,
            p.shares_count,
            p.created_at,
            pr.id            AS profile_id,
            pr.username      AS profile_username,
            pr.display_name  AS profile_display_name,
            pr.emoji         AS profile_emoji,
            pr.badge         AS profile_badge,
            pr.is_verified   AS profile_is_verified
       FROM posts p
  LEFT JOIN profiles pr ON pr.id = p.author_id
   ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?`,
    [limit, offset],
  );

  const out = rows.map((row) => ({
    id: row.id,
    author_id: row.author_id,
    content: row.content,
    image_url: row.image_url,
    likes_count: row.likes_count,
    comments_count: row.comments_count,
    shares_count: row.shares_count,
    created_at: row.created_at,
    profiles: row.profile_id
      ? normalizeProfile({
          id: row.profile_id,
          username: row.profile_username,
          display_name: row.profile_display_name,
          emoji: row.profile_emoji,
          badge: row.profile_badge,
          is_verified: row.profile_is_verified,
          links: null,
        })
      : null,
  }));
  return ok(req, out);
});
