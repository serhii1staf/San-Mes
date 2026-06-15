// Smoke tests for the profile endpoints.
//
// Coverage:
//   - GET /v1/profiles/:id with a malformed UUID returns 400
//   - GET /v1/profiles/:id with no matching row returns 200 + null
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

  it('returns 200 + null for a missing profile', async () => {
    const { env } = makeEnv();
    const res = await worker.fetch(
      new Request('https://test.local/v1/profiles/00000000-0000-0000-0000-000000000000'),
      env,
      fakeCtx,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: null, error: null });
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
