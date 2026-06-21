// Follow / unfollow endpoints.
//
// PUT    /v1/profiles/:id/follow                       — idempotent follow.
// DELETE /v1/profiles/:id/follow                       — unfollow.
// GET    /v1/follows/:followerId/:followingId/exists   — is-following probe.
//
// The probe endpoint shaves a roundtrip on screens that need to know
// follow state for a single (a, b) pair without paginating the full
// following list (e.g. the profile header's "Follow" button).

import { fail, ok } from '../http';
import { register } from '../router';
import { exec, queryOne } from '../db';
import { parseUuid } from '../util';
import { channels, publishEvent } from '../realtime';
import { sendPushToUser } from '../push';

// ── PUT /v1/profiles/:id/follow ───────────────────────────────────────
register('PUT', '/v1/profiles/:id/follow', async (req, env, ctx, params, authedUserId) => {
  if (!authedUserId) return fail(req, 'unauthorised', 401);
  const followingId = parseUuid(params.id);
  if (!followingId) return fail(req, 'invalid profile id', 400);
  if (followingId === authedUserId) return fail(req, 'cannot follow self', 400);

  // INSERT OR IGNORE makes this idempotent — double-tapping the follow
  // button doesn't 23505 (duplicate key) the way Supabase's path could.
  const now = new Date().toISOString();
  await exec(
    env,
    `INSERT OR IGNORE INTO follows (follower_id, following_id, created_at) VALUES (?, ?, ?)`,
    [authedUserId, followingId, now],
  );

  // Three channels for one mutation:
  //   1) `user:<target>:follows` — the followed user's other devices
  //      see their followers list grow.
  //   2) `user:<target>:notifications` — the followed user gets a
  //      notification ping wherever they're connected.
  //   3) `user:<self>:follows` — the follower's other devices keep
  //      their following list in sync.
  const followPayload = {
    follower_id: authedUserId,
    following_id: followingId,
    created_at: now,
  };
  publishEvent(env, channels.userFollows(followingId), 'follow.added', followPayload, ctx);
  publishEvent(
    env,
    channels.userNotifications(followingId),
    'notif.follow',
    { follower_id: authedUserId, ts: now },
    ctx,
  );
  publishEvent(
    env,
    channels.userFollows(authedUserId),
    'follow.outgoing.added',
    followPayload,
    ctx,
  );
  // Push the new follower to the followed user's device(s).
  const follower = await queryOne<{ username: string; display_name: string }>(
    env,
    `SELECT username, display_name FROM profiles WHERE id = ?`,
    [authedUserId],
  );
  const followerName = follower?.display_name || follower?.username || 'Someone';
  sendPushToUser(env, ctx, followingId, {
    title: followerName,
    body: 'started following you',
    data: { type: 'follow', follower_id: authedUserId },
  });
  return ok(req, { following: true });
});

// ── DELETE /v1/profiles/:id/follow ────────────────────────────────────
register('DELETE', '/v1/profiles/:id/follow', async (req, env, ctx, params, authedUserId) => {
  if (!authedUserId) return fail(req, 'unauthorised', 401);
  const followingId = parseUuid(params.id);
  if (!followingId) return fail(req, 'invalid profile id', 400);
  await exec(
    env,
    `DELETE FROM follows WHERE follower_id = ? AND following_id = ?`,
    [authedUserId, followingId],
  );
  const unfollowPayload = {
    follower_id: authedUserId,
    following_id: followingId,
  };
  publishEvent(env, channels.userFollows(followingId), 'follow.removed', unfollowPayload, ctx);
  publishEvent(
    env,
    channels.userFollows(authedUserId),
    'follow.outgoing.removed',
    unfollowPayload,
    ctx,
  );
  return ok(req, { following: false });
});

// ── GET /v1/follows/:followerId/:followingId/exists ───────────────────
register('GET', '/v1/follows/:followerId/:followingId/exists', async (req, env, _ctx, params) => {
  const followerId = parseUuid(params.followerId);
  const followingId = parseUuid(params.followingId);
  if (!followerId || !followingId) return fail(req, 'invalid id', 400);
  const row = await queryOne<{ x: number }>(
    env,
    `SELECT 1 AS x FROM follows WHERE follower_id = ? AND following_id = ? LIMIT 1`,
    [followerId, followingId],
  );
  return ok(req, { exists: !!row });
});
