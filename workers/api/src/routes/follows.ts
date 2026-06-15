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

// ── PUT /v1/profiles/:id/follow ───────────────────────────────────────
register('PUT', '/v1/profiles/:id/follow', async (req, env, _ctx, params, authedUserId) => {
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
  return ok(req, { following: true });
});

// ── DELETE /v1/profiles/:id/follow ────────────────────────────────────
register('DELETE', '/v1/profiles/:id/follow', async (req, env, _ctx, params, authedUserId) => {
  if (!authedUserId) return fail(req, 'unauthorised', 401);
  const followingId = parseUuid(params.id);
  if (!followingId) return fail(req, 'invalid profile id', 400);
  await exec(
    env,
    `DELETE FROM follows WHERE follower_id = ? AND following_id = ?`,
    [authedUserId, followingId],
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
