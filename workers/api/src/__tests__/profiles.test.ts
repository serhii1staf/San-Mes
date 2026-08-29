// Smoke tests for the profile endpoints.
//
// Coverage:
//   - GET /v1/profiles/:id with a malformed UUID returns 400
//   - GET /v1/profiles/:id with no matching row returns 404 (see the note on that test — it
//     previously asserted 200 + null, which is the response that made a deleted account keep
//     rendering from the client's cache)
//   - GET /v1/profiles/:id/follow-counts returns the {followers, following} shape
//   - GET /v1/conversations without a JWT returns 401 (the central
//     dispatcher path; lives here because it's the cheapest authed
//     endpoint to exercise the rule)

import { describe, it, expect } from 'vitest';
import worker from '../index';
import { fakeCtx, makeEnv } from './stubD1';

describe('GET /v1/profiles/:id', () => {
  it('400s on an invalid UUID', async () => {
    const { env } = makeEnv();
    const res = await worker.fetch(
      new Request('https://test.local/v1/profiles/not-a-uuid'),
      env,
      fakeCtx,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/invalid profile id/);
  });

  // ── THIS TEST USED TO ASSERT THE BUG ──────────────────────────────────────
  //
  // It read `returns 200 + null for a missing profile`, and it passed for as long as the endpoint did
  // exactly that. The behaviour it was protecting is what made a working account deletion look broken:
  //
  //   `getProfile` maps a 200-with-null body to `{ profile: null, error: null }`. With no error to
  //   distinguish "this person is gone" from "the fetch came back with nothing", `syncProfile`
  //   treated it as success, left the cached row in place, and stamped its ten-minute throttle — so
  //   `app/profile/[id].tsx`, which prefers `cachedProfile` over anything else, kept rendering a
  //   deleted account indefinitely. Reported as "я удалил аккаунт... а он всё равно есть".
  //
  // Verified against production before changing anything: registering a throwaway account, deleting
  // it, and re-reading the row showed the profile genuinely gone from `profiles` while this endpoint
  // still answered 200. The deletion was never the bug; this response was.
  //
  // Kept as a test rather than deleted, with the assertion inverted, because the contract is the point:
  // "does this resource exist" must be answerable from the status code alone.
  it('404s for a missing profile, so a deleted account cannot be served from cache', async () => {
    const { env } = makeEnv();
    const res = await worker.fetch(
      new Request('https://test.local/v1/profiles/00000000-0000-0000-0000-000000000000'),
      env,
      fakeCtx,
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { data: unknown; error: string };
    expect(body.data).toBeNull();
    // The client's purge matches on this text as well as the status — see `syncProfile`.
    expect(body.error).toMatch(/not found/i);
  });
});

describe('GET /v1/profiles/:id/follow-counts', () => {
  it('returns {followers:0, following:0} on empty DB', async () => {
    const { env } = makeEnv();
    const res = await worker.fetch(
      new Request('https://test.local/v1/profiles/00000000-0000-0000-0000-000000000000/follow-counts'),
      env,
      fakeCtx,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: { followers: 0, following: 0 },
      error: null,
    });
  });
});

describe('GET /v1/conversations', () => {
  it('401s when no JWT is present', async () => {
    const { env } = makeEnv();
    const res = await worker.fetch(
      new Request('https://test.local/v1/conversations'),
      env,
      fakeCtx,
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('unauthorised');
  });
});
