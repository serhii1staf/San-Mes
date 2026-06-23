// Backend round-trip integration tests for the seasonal profile theme_id.
//
// Task 9.6 (spec: seasonal-profile-themes). Covers the server-side
// persistence + propagation path for the public `theme_id`:
//
//   1. PATCH /v1/profiles/me persists `theme_id`, and reading the
//      profile back returns it (round-trip). Because the Worker exposes
//      no GET /v1/profiles/me, the owner reads their own row through the
//      same projection via GET /v1/profiles/:id — the PATCH response and
//      the subsequent GET both carry the stored `theme_id` (Req 3.1).
//   2. GET /v1/profiles/:id includes `theme_id` in the public profile
//      data for any viewer (Req 3.3).
//   3. A `theme_id` change fans out as a realtime `profile.edit` delta
//      carrying `theme_id`, so a mounted profile can update without a
//      restart — this exercises the PATCH handler's delta-mapping path
//      (only changed fields ride the event) (Req 3.4).
//
// Unlike the smoke tests in `profiles.test.ts` (which use the stateless
// `makeStubD1` that always lands on the empty-DB path), these tests need
// real persistence to observe a round-trip, so they use a small stateful
// in-memory profile store that honours `SELECT … WHERE id = ?` and
// `UPDATE profiles SET … WHERE id = ?`.

import { describe, it, expect, vi, afterEach } from 'vitest';
import worker from '../index';
import { signToken } from '../auth';

// A canonical lower-case UUID so `parseUuid` accepts it on the GET path.
const USER_ID = '11111111-1111-1111-1111-111111111111';

interface EnvExtras {
  ABLY_ROOT_KEY?: string;
}

/**
 * Build an env whose D1 binding is a stateful in-memory profile store.
 * Only the SQL shapes the profile route actually issues are handled:
 *   - `SELECT <cols> FROM profiles WHERE id = ? LIMIT 1`  → first()
 *   - `SELECT id FROM profiles WHERE username = ? …`      → first() (always null)
 *   - `UPDATE profiles SET <c = ?, …> WHERE id = ?`       → run()
 */
function makeStatefulEnv(
  seed: Record<string, Record<string, unknown>>,
  extras: EnvExtras = {},
) {
  const store = new Map<string, Record<string, unknown>>();
  for (const [id, row] of Object.entries(seed)) store.set(id, { ...row });

  const prepare = (sql: string) => {
    let bound: unknown[] = [];
    const norm = sql.trim().replace(/\s+/g, ' ');
    const upper = norm.toUpperCase();
    const stmt = {
      bind(...p: unknown[]) {
        bound = p;
        return stmt;
      },
      async first<T>(): Promise<T | null> {
        if (/FROM profiles WHERE id = \? LIMIT 1$/i.test(norm)) {
          const id = bound[0] as string;
          const row = store.get(id);
          return (row ? { ...row } : null) as T | null;
        }
        if (/SELECT id FROM profiles WHERE username = \?/i.test(norm)) {
          // No username collisions in these tests.
          return null;
        }
        return null;
      },
      async all<T>(): Promise<{ results: T[] }> {
        return { results: [] };
      },
      async run() {
        if (upper.startsWith('UPDATE PROFILES SET ')) {
          const setStart = upper.indexOf('SET ') + 4;
          const whereStart = upper.lastIndexOf(' WHERE ');
          const setClause = norm.slice(setStart, whereStart);
          const cols = setClause
            .split(',')
            .map((part) => part.split('=')[0].trim());
          const id = bound[bound.length - 1] as string;
          const row = store.get(id);
          if (row) {
            cols.forEach((col, i) => {
              row[col] = bound[i];
            });
          }
        }
        return { meta: {}, success: true } as unknown as D1Result;
      },
    };
    return stmt;
  };

  const DB = {
    prepare,
    async batch(stmts: any[]) {
      return Promise.all(stmts.map((s) => s.run()));
    },
  };

  const env = {
    DB: DB as any,
    SUPABASE_PROJECT_REF: 'test-ref',
    JWT_SECRET: 'test-jwt-secret-do-not-use-in-prod',
    ADMIN_KEY: 'test-admin-key',
    ...extras,
  };
  return { env, store };
}

// A ctx that actually retains `waitUntil` promises so a fire-and-forget
// realtime publish can be awaited before assertions.
function makeCtx() {
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil(p: Promise<unknown>) {
      pending.push(p);
    },
    passThroughOnException() {},
  } as unknown as ExecutionContext;
  return { ctx, settle: () => Promise.all(pending) };
}

function seedProfile(extra: Record<string, unknown> = {}) {
  return {
    [USER_ID]: {
      id: USER_ID,
      username: 'milord',
      display_name: 'Milord',
      emoji: '🙂',
      bio: null,
      pin_hash: 'secret-hash',
      device_key: 'secret-device-key',
      banner_url: null,
      links: null,
      badge: null,
      is_verified: 0,
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
      theme_id: null,
      ...extra,
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('theme_id round-trip via PATCH /v1/profiles/me', () => {
  it('persists theme_id on PATCH and returns it on a subsequent GET', async () => {
    const { env, store } = makeStatefulEnv(seedProfile());
    const { ctx, settle } = makeCtx();
    const token = await signToken(env, USER_ID);

    const patchRes = await worker.fetch(
      new Request('https://test.local/v1/profiles/me', {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ theme_id: 'winter' }),
      }),
      env,
      ctx,
    );
    await settle();

    expect(patchRes.status).toBe(200);
    const patchBody = (await patchRes.json()) as {
      data: { theme_id: string } | null;
      error: string | null;
    };
    expect(patchBody.error).toBeNull();
    expect(patchBody.data?.theme_id).toBe('winter');
    // The value was actually written to the row, not just echoed.
    expect(store.get(USER_ID)?.theme_id).toBe('winter');

    // Read the owner's row back through the public projection.
    const getRes = await worker.fetch(
      new Request(`https://test.local/v1/profiles/${USER_ID}`),
      env,
      makeCtx().ctx,
    );
    expect(getRes.status).toBe(200);
    const getBody = (await getRes.json()) as {
      data: { theme_id: string } | null;
    };
    expect(getBody.data?.theme_id).toBe('winter');
  });

  it('rejects an unknown theme_id and retains the previously stored value', async () => {
    const { env, store } = makeStatefulEnv(seedProfile({ theme_id: 'spring' }));
    const { ctx, settle } = makeCtx();
    const token = await signToken(env, USER_ID);

    const res = await worker.fetch(
      new Request('https://test.local/v1/profiles/me', {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ theme_id: 'not-a-real-theme' }),
      }),
      env,
      ctx,
    );
    await settle();

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_theme_id');
    // The stored value is untouched (Req 3.7).
    expect(store.get(USER_ID)?.theme_id).toBe('spring');
  });
});

describe('GET /v1/profiles/:id includes theme_id', () => {
  it('returns the stored theme_id in the public profile data for any viewer', async () => {
    const { env } = makeStatefulEnv(seedProfile({ theme_id: 'autumn' }));

    const res = await worker.fetch(
      new Request(`https://test.local/v1/profiles/${USER_ID}`),
      env,
      makeCtx().ctx,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Record<string, unknown> | null;
    };
    expect(body.data).not.toBeNull();
    expect(body.data).toHaveProperty('theme_id', 'autumn');
  });

  it('returns theme_id = null when none is selected', async () => {
    const { env } = makeStatefulEnv(seedProfile());

    const res = await worker.fetch(
      new Request(`https://test.local/v1/profiles/${USER_ID}`),
      env,
      makeCtx().ctx,
    );
    const body = (await res.json()) as { data: { theme_id: unknown } | null };
    expect(body.data?.theme_id).toBeNull();
  });
});

describe('realtime profile.edit delta carries theme_id', () => {
  it('publishes a profile.edit event whose delta includes the changed theme_id', async () => {
    const { env } = makeStatefulEnv(seedProfile({ theme_id: 'default-dark' }), {
      // Enable realtime so publishEvent fires its outbound POST.
      ABLY_ROOT_KEY: 'test-ably-key',
    });
    const { ctx, settle } = makeCtx();
    const token = await signToken(env, USER_ID);

    const published: { url: string; name: string; data: any }[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (input: any, init: any) => {
        const url = String(typeof input === 'string' ? input : input?.url);
        const parsed = JSON.parse(String(init?.body ?? '{}'));
        published.push({ url, name: parsed.name, data: parsed.data });
        return new Response(null, { status: 201 });
      },
    );

    const res = await worker.fetch(
      new Request('https://test.local/v1/profiles/me', {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ theme_id: 'purple-pixel' }),
      }),
      env,
      ctx,
    );
    await settle();

    expect(res.status).toBe(200);

    const edit = published.find((p) => p.name === 'profile.edit');
    expect(edit, 'a profile.edit event should be published').toBeDefined();
    expect(edit!.url).toContain('rest.ably.io');
    // The delta-mapping path puts the changed theme_id on the event so a
    // mounted profile updates live, without an app restart (Req 3.4).
    expect(edit!.data.id).toBe(USER_ID);
    expect(edit!.data.theme_id).toBe('purple-pixel');
    expect(edit!.data.updated_at).toEqual(expect.any(String));
  });

  it('does not fan out theme_id when the value is unchanged (delta is empty)', async () => {
    const { env } = makeStatefulEnv(seedProfile({ theme_id: 'winter' }), {
      ABLY_ROOT_KEY: 'test-ably-key',
    });
    const { ctx, settle } = makeCtx();
    const token = await signToken(env, USER_ID);

    const published: { name: string }[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (_input: any, init: any) => {
        const parsed = JSON.parse(String(init?.body ?? '{}'));
        published.push({ name: parsed.name });
        return new Response(null, { status: 201 });
      },
    );

    const res = await worker.fetch(
      new Request('https://test.local/v1/profiles/me', {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        // Same theme_id already stored → no delta → no realtime publish.
        body: JSON.stringify({ theme_id: 'winter' }),
      }),
      env,
      ctx,
    );
    await settle();

    expect(res.status).toBe(200);
    expect(published.find((p) => p.name === 'profile.edit')).toBeUndefined();
  });
});
