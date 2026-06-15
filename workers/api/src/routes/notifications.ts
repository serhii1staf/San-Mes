// GET /v1/notifications
//
// Synthesises the notifications screen's three event streams (likes
// targeting my posts, comments on my posts, follows of me) into a
// single JSON envelope so the client can do one round-trip instead of
// the existing three-call Promise.all. Authed only.
//
// Returns:
//   {
//     likes:    [{ user_id, post_id, created_at, profiles: {...} }, ...]
//     comments: [{ id, author_id, post_id, content, created_at, profiles: {...} }, ...]
//     follows:  [{ follower_id, created_at, profiles: {...} }, ...]
//   }
// Each list is capped at 80 rows newest-first — same as the existing
// per-call cap on the screen.

import { fail, ok } from '../http';
import { register } from '../router';
import { normalizeProfile, query } from '../db';

const PROFILE_EMBED = `pr.id AS profile_id, pr.username AS profile_username, pr.display_name AS profile_display_name, pr.emoji AS profile_emoji, pr.is_verified AS profile_is_verified, pr.badge AS profile_badge`;

interface ActorRow {
  profile_id: string | null;
  profile_username: string | null;
  profile_display_name: string | null;
  profile_emoji: string | null;
  profile_is_verified: number | null;
  profile_badge: string | null;
}

function shapeActor(row: ActorRow) {
  return row.profile_id
    ? normalizeProfile({
        id: row.profile_id,
        username: row.profile_username,
        display_name: row.profile_display_name,
        emoji: row.profile_emoji,
        is_verified: row.profile_is_verified,
        badge: row.profile_badge,
        links: null,
      })
    : null;
}

register('GET', '/v1/notifications', async (req, env, _ctx, _params, authedUserId) => {
  if (!authedUserId) return fail(req, 'unauthorised', 401);

  // We need the user's recent posts to scope likes/comments to "their
  // own content". Cap at 200 rows — older posts very rarely receive
  // fresh attention.
  const myPosts = await query<{ id: string; content: string }>(
    env,
    `SELECT id, content FROM posts WHERE author_id = ? ORDER BY created_at DESC LIMIT 200`,
    [authedUserId],
  );
  const myPostIds = myPosts.map((p) => p.id);

  if (myPostIds.length === 0) {
    // No posts → no like/comment events targeting me. Still fetch
    // follows so the user sees new followers on a fresh account.
    const follows = await query<ActorRow & { follower_id: string; created_at: string }>(
      env,
      `SELECT f.follower_id, f.created_at, ${PROFILE_EMBED}
         FROM follows f
    LEFT JOIN profiles pr ON pr.id = f.follower_id
        WHERE f.following_id = ? AND f.follower_id != ?
     ORDER BY f.created_at DESC
        LIMIT 80`,
      [authedUserId, authedUserId],
    );
    return ok(req, {
      likes: [],
      comments: [],
      follows: follows.map((r) => ({
        follower_id: r.follower_id,
        created_at: r.created_at,
        profiles: shapeActor(r),
      })),
    });
  }

  const placeholders = myPostIds.map(() => '?').join(',');

  // Three queries in parallel — same-shape as the previous Supabase
  // Promise.all, just with the JOINs running on D1.
  const [likes, comments, follows] = await Promise.all([
    query<
      ActorRow & {
        user_id: string;
        post_id: string;
        created_at: string;
      }
    >(
      env,
      `SELECT l.user_id, l.post_id, l.created_at, ${PROFILE_EMBED}
         FROM likes l
    LEFT JOIN profiles pr ON pr.id = l.user_id
        WHERE l.post_id IN (${placeholders})
          AND l.user_id != ?
     ORDER BY l.created_at DESC
        LIMIT 80`,
      [...myPostIds, authedUserId],
    ),
    query<
      ActorRow & {
        id: string;
        author_id: string;
        post_id: string;
        content: string;
        created_at: string;
      }
    >(
      env,
      `SELECT c.id, c.author_id, c.post_id, c.content, c.created_at, ${PROFILE_EMBED}
         FROM comments c
    LEFT JOIN profiles pr ON pr.id = c.author_id
        WHERE c.post_id IN (${placeholders})
          AND c.author_id != ?
     ORDER BY c.created_at DESC
        LIMIT 80`,
      [...myPostIds, authedUserId],
    ),
    query<
      ActorRow & {
        follower_id: string;
        created_at: string;
      }
    >(
      env,
      `SELECT f.follower_id, f.created_at, ${PROFILE_EMBED}
         FROM follows f
    LEFT JOIN profiles pr ON pr.id = f.follower_id
        WHERE f.following_id = ? AND f.follower_id != ?
     ORDER BY f.created_at DESC
        LIMIT 80`,
      [authedUserId, authedUserId],
    ),
  ]);

  return ok(req, {
    likes: likes.map((r) => ({
      user_id: r.user_id,
      post_id: r.post_id,
      created_at: r.created_at,
      profiles: shapeActor(r),
    })),
    comments: comments.map((r) => ({
      id: r.id,
      author_id: r.author_id,
      post_id: r.post_id,
      content: r.content,
      created_at: r.created_at,
      profiles: shapeActor(r),
    })),
    follows: follows.map((r) => ({
      follower_id: r.follower_id,
      created_at: r.created_at,
      profiles: shapeActor(r),
    })),
  });
});

// Suppress unused export warning — the route registers via side effect.
export const _registered = true;
