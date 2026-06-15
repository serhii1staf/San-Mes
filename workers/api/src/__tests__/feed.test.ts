// Smoke tests for `GET /v1/feed`.
//
// These run against the in-process Worker default export with a stubbed
// D1 binding (see `stubD1.ts`). They cover:
//   - empty-DB happy path
//   - limit / offset clamping
//   - shape of a populated row including the embedded profile

import { describe, it, expect } from 'vitest';
import worker from '../index';
import { fakeCtx, makeEnv } from './stubD1';

const FEED_SQL_KEY = `SELECT p.id,
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
      LIMIT ? OFFSET ?`;

describe('GET /v1/feed', () => {
  it('returns an empty array on empty DB', async () => {
    const { env } = makeEnv();
    const res = await worker.fetch(
      new Request('https://test.local/v1/feed'),
      env,
      fakeCtx,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ data: [], error: null });
  });

  it('clamps limit to [1, 50] and offset to >= 0', async () => {
    const { env, captured } = makeEnv();
    await worker.fetch(
      new Request('https://test.local/v1/feed?limit=999&offset=-5'),
      env,
      fakeCtx,
    );
    // The last captured statement is the feed query; binds were [limit, offset].
    const last = captured[captured.length - 1];
    expect(last.params).toEqual([50, 0]);
  });

  it('shapes a populated row with embedded profile', async () => {
    const row = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      author_id: '550e8400-e29b-41d4-a716-446655440001',
      content: 'hello world',
      image_url: null,
      likes_count: 3,
      comments_count: 1,
      shares_count: 0,
      created_at: '2026-01-01T00:00:00.000Z',
      profile_id: '550e8400-e29b-41d4-a716-446655440001',
      profile_username: 'alice',
      profile_display_name: 'Alice',
      profile_emoji: '🌟',
      profile_badge: null,
      profile_is_verified: 1,
    };
    const { env } = makeEnv({
      all: { [FEED_SQL_KEY.trim()]: [row] },
    });
    const res = await worker.fetch(
      new Request('https://test.local/v1/feed?limit=5'),
      env,
      fakeCtx,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: any[]; error: null };
    expect(body.error).toBeNull();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      id: row.id,
      author_id: row.author_id,
      content: 'hello world',
      profiles: {
        id: row.profile_id,
        username: 'alice',
        display_name: 'Alice',
        emoji: '🌟',
        badge: null,
        is_verified: true, // normalised from 1
        links: null,
      },
    });
  });
});
