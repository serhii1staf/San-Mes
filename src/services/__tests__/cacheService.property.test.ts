// Property-based tests for the per-account-cache key-building logic in cacheService.
//
// Library: fast-check (see .kiro/specs/per-account-cache/design.md → Testing Strategy).
// AsyncStorage is mocked in-memory via jest.setup.js so 100+ iterations stay cheap.
//
// Convention: each property test is tagged with
//   // Feature: per-account-cache, Property {N}: {краткий текст свойства}
// and runs with at least 100 iterations: fc.assert(prop, { numRuns: 100 }).

import fc from 'fast-check';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  accountKey,
  setCacheAccount,
  cacheGet,
  cacheSet,
  cacheFeed,
  getCachedFeed,
  MAX_FEED_POSTS,
  type LocalPost,
} from '../cacheService';
import { namespaced, GLOBAL_KEY_PREFIXES } from '../cacheAccount';

// A base key that is account-scoped (does NOT start with a global prefix).
const accountScopedBaseKey = fc
  .string({ minLength: 1, maxLength: 40 })
  .map((s) => `@san:${s}`)
  .filter((k) => !GLOBAL_KEY_PREFIXES.some((p) => k.startsWith(p)));

// Account ids: non-empty strings (so they never collapse to the anon fallback).
const accountId = fc.string({ minLength: 1, maxLength: 24 }).filter((s) => s.trim().length > 0);

// A JSON-serializable, non-null value (cacheGet returns the fallback for null).
const serializableValue = fc
  .jsonValue()
  .map((v) => JSON.parse(JSON.stringify(v)))
  .filter((v) => v !== null && v !== undefined);

describe('cacheService key-building properties', () => {
  // ───────────────────────────────────────────────────────────────────────────
  // Feature: per-account-cache, Property 1: Account-scoped ключи изолированы между аккаунтами
  // Validates: Requirements 1.1, 1.2, 1.4, 1.5, 2.5, 3.4, 9.4
  it('Property 1: account-scoped keys differ across accounts and are deterministic per account', () => {
    fc.assert(
      fc.property(accountId, accountId, accountScopedBaseKey, (a, b, baseKey) => {
        fc.pre(a !== b);

        // Different accounts → different storage keys.
        setCacheAccount(a);
        const keyA = accountKey(baseKey);
        setCacheAccount(b);
        const keyB = accountKey(baseKey);
        expect(keyA).not.toBe(keyB);

        // Same account → deterministic, stable key.
        setCacheAccount(a);
        expect(accountKey(baseKey)).toBe(keyA);
        expect(accountKey(baseKey)).toBe(keyA);
      }),
      { numRuns: 100 }
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Feature: per-account-cache, Property 2: Global_Shared_Data не неймспейсится
  // Validates: Requirements 1.3, 4.1, 4.2, 4.3, 4.4
  it('Property 2: global-shared keys are returned unchanged by namespaced()', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...GLOBAL_KEY_PREFIXES),
        fc.string({ maxLength: 40 }),
        accountId,
        (prefix, suffix, id) => {
          const key = `${prefix}${suffix}`;
          setCacheAccount(id);
          // namespaced() must leave global keys untouched, regardless of active account.
          expect(namespaced(key)).toBe(key);
        }
      ),
      { numRuns: 100 }
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Feature: per-account-cache, Property 3: round-trip записи/чтения в рамках одного аккаунта
  // Validates: Requirements 1.2, 1.5, 11.2
  it('Property 3: cacheSet → cacheGet round-trips a value within one account', async () => {
    await fc.assert(
      fc.asyncProperty(accountId, accountScopedBaseKey, serializableValue, async (id, baseKey, value) => {
        setCacheAccount(id);
        await cacheSet(baseKey, value);
        const read = await cacheGet(baseKey, null);
        expect(read).toStrictEqual(value);
      }),
      { numRuns: 100 }
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Feature: per-account-cache, Property 4: Чтение под чужим аккаунтом не видит данные другого аккаунта
  // Validates: Requirements 1.5, 2.5, 3.4, 9.4, 14.4
  it('Property 4: reading under a different account returns the fallback, not account A data', async () => {
    const FALLBACK = Symbol('fallback') as unknown;
    await fc.assert(
      fc.asyncProperty(accountId, accountId, accountScopedBaseKey, serializableValue, async (a, b, baseKey, value) => {
        fc.pre(a !== b);

        setCacheAccount(a);
        await cacheSet(baseKey, value);

        setCacheAccount(b);
        const read = await cacheGet(baseKey, FALLBACK);
        expect(read).toBe(FALLBACK);
      }),
      { numRuns: 100 }
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Feature: per-account-cache, Property 5: Anon fallback при пустом id
  // Validates: Requirements 14.1, 14.2, 14.3
  it('Property 5: empty/null/undefined account id falls back to the "anon" namespace', () => {
    fc.assert(
      fc.property(fc.constantFrom(null, undefined, ''), accountScopedBaseKey, (emptyId, baseKey) => {
        setCacheAccount(emptyId as string | null | undefined);
        expect(accountKey(baseKey)).toBe(`@acc:anon:${baseKey}`);
      }),
      { numRuns: 100 }
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Feature: per-account-cache, Property 8: Лента ограничена MAX_FEED_POSTS
  // Validates: Requirements 12.3
  it('Property 8: cacheFeed caps the stored feed at MAX_FEED_POSTS, keeping the newest by created_at', async () => {
    // Unique timestamps → deterministic ordering (no ties).
    const uniqueTimestamps = fc.uniqueArray(fc.integer({ min: 0, max: 4_000_000_000_000 }), {
      minLength: 0,
      maxLength: 260,
    });

    await fc.assert(
      fc.asyncProperty(accountId, uniqueTimestamps, async (id, timestamps) => {
        setCacheAccount(id);

        const posts: LocalPost[] = timestamps.map((ts, i) => ({
          id: `post-${i}`,
          author_id: 'author',
          content: `content-${i}`,
          image_url: null,
          likes_count: 0,
          comments_count: 0,
          shares_count: 0,
          created_at: new Date(ts).toISOString(),
        }));

        await cacheFeed(posts);
        const stored = await getCachedFeed();

        // Size never exceeds the cap.
        expect(stored.length).toBeLessThanOrEqual(MAX_FEED_POSTS);
        expect(stored.length).toBe(Math.min(posts.length, MAX_FEED_POSTS));

        // Stored posts are exactly the newest-by-created_at slice.
        const expectedIds = [...posts]
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
          .slice(0, MAX_FEED_POSTS)
          .map((p) => p.id);
        expect(stored.map((p) => p.id)).toStrictEqual(expectedIds);
      }),
      { numRuns: 100 }
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Feature: per-account-cache, Property 9: Cache-helpers устойчивы к сбоям AsyncStorage
  // Validates: Requirements 13.1, 13.2, 13.3, 13.4
  it('Property 9: cache helpers return the fallback and never throw on storage failures or invalid JSON', async () => {
    await fc.assert(
      fc.asyncProperty(
        accountId,
        accountScopedBaseKey,
        serializableValue,
        fc.constantFrom('read-throws', 'invalid-json', 'write-throws'),
        async (id, baseKey, fallback, scenario) => {
          setCacheAccount(id);

          if (scenario === 'read-throws') {
            const spy = jest
              .spyOn(AsyncStorage, 'getItem')
              .mockRejectedValueOnce(new Error('boom'));
            const read = await cacheGet(baseKey, fallback);
            expect(read).toStrictEqual(fallback);
            spy.mockRestore();
          } else if (scenario === 'invalid-json') {
            // Seed the (namespaced) key with a string that is not valid JSON.
            await AsyncStorage.setItem(namespaced(baseKey), '{not valid json::');
            const read = await cacheGet(baseKey, fallback);
            expect(read).toStrictEqual(fallback);
          } else {
            const spy = jest
              .spyOn(AsyncStorage, 'setItem')
              .mockRejectedValueOnce(new Error('boom'));
            // Must not throw despite the write failure.
            await expect(cacheSet(baseKey, fallback)).resolves.toBeUndefined();
            spy.mockRestore();
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
