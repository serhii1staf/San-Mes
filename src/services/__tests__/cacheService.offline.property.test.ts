// Property-based tests for the async-storage-offline cache service.
//
// Library: fast-check (see .kiro/specs/async-storage-offline/design.md → Testing Strategy).
// AsyncStorage is mocked in-memory via jest.setup.js so 100+ iterations stay cheap.
//
// Convention: each property test is tagged with
//   // Feature: async-storage-offline, Property {N}: {short description}
// and runs with at least 100 iterations: fc.assert(prop, { numRuns: 100 }).

import fc from 'fast-check';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  setCacheAccount,
  cacheProfile,
  getCachedProfile,
  cacheConversations,
  getCachedConversations,
  cacheMessages,
  getCachedMessages,
  cacheLikes,
  getCachedLikes,
  cacheFollows,
  getCachedFollows,
  cacheFeed,
  getCachedFeed,
  cacheGet,
  cacheSet,
  KEYS,
  MAX_FEED_POSTS,
  type LocalPost,
  type LocalProfile,
  type LocalConversation,
  type LocalMessage,
} from '../cacheService';
import { namespaced } from '../cacheAccount';

// ─── Generators ────────────────────────────────────────────────────────────

const nonEmptyId = fc.string({ minLength: 1, maxLength: 24 }).filter((s) => s.trim().length > 0);

const isoDate = fc
  .integer({ min: 0, max: 4_000_000_000_000 })
  .map((ts) => new Date(ts).toISOString());

// Posts with only concrete (non-undefined) fields so JSON round-trips are exact.
const postArb: fc.Arbitrary<LocalPost> = fc.record({
  id: nonEmptyId,
  author_id: nonEmptyId,
  content: fc.string({ maxLength: 80 }),
  image_url: fc.option(fc.webUrl(), { nil: null }),
  likes_count: fc.nat({ max: 100000 }),
  comments_count: fc.nat({ max: 100000 }),
  shares_count: fc.nat({ max: 100000 }),
  created_at: isoDate,
});

const profileArb: fc.Arbitrary<LocalProfile> = fc.record({
  id: nonEmptyId,
  username: nonEmptyId,
  display_name: fc.string({ minLength: 1, maxLength: 40 }),
  emoji: fc.string({ maxLength: 4 }),
  bio: fc.string({ maxLength: 120 }),
  banner_url: fc.option(fc.webUrl(), { nil: null }),
  links: fc.option(fc.string({ maxLength: 60 }), { nil: null }),
  created_at: fc.option(isoDate, { nil: null }),
  updated_at: fc.option(isoDate, { nil: null }),
});

const conversationArb: fc.Arbitrary<LocalConversation> = fc.record({
  id: nonEmptyId,
  participantId: nonEmptyId,
  participantName: fc.string({ maxLength: 40 }),
  participantUsername: fc.string({ maxLength: 40 }),
  participantEmoji: fc.string({ maxLength: 4 }),
});

const messageArb: fc.Arbitrary<LocalMessage> = fc.record({
  id: nonEmptyId,
  conversation_id: nonEmptyId,
  sender_id: nonEmptyId,
  text: fc.string({ maxLength: 120 }),
  created_at: isoDate,
});

beforeEach(() => {
  setCacheAccount('test-account');
});

describe('async-storage-offline cacheService properties', () => {
  // ───────────────────────────────────────────────────────────────────────────
  // Feature: async-storage-offline, Property 1: Cache round-trip preservation
  // **Validates: Requirements 1.1, 1.3**
  it('Property 1: writing an entity then reading it back yields the original entity', async () => {
    await fc.assert(
      fc.asyncProperty(
        profileArb,
        fc.array(conversationArb, { maxLength: 10 }),
        fc.array(messageArb, { maxLength: 10 }),
        fc.uniqueArray(nonEmptyId, { maxLength: 20 }),
        fc.uniqueArray(nonEmptyId, { maxLength: 20 }),
        async (profile, conversations, messages, likeIds, followIds) => {
          // Profile round-trip
          await cacheProfile(profile.id, profile);
          expect(await getCachedProfile(profile.id)).toStrictEqual(profile);

          // Conversations round-trip
          await cacheConversations(conversations);
          expect(await getCachedConversations()).toStrictEqual(conversations);

          // Messages round-trip (keyed by conversation id)
          const convId = 'conv-rt';
          await cacheMessages(convId, messages);
          expect(await getCachedMessages(convId)).toStrictEqual(messages);

          // Likes round-trip
          const userId = 'user-rt';
          await cacheLikes(userId, likeIds);
          expect(await getCachedLikes(userId)).toStrictEqual(likeIds);

          // Follows round-trip
          await cacheFollows(userId, followIds);
          expect(await getCachedFollows(userId)).toStrictEqual(followIds);
        }
      ),
      { numRuns: 100 }
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Feature: async-storage-offline, Property 1 (feed): round-trip preserves the
  // newest-by-created_at ordering for a within-limit feed.
  // **Validates: Requirements 1.1, 1.3**
  it('Property 1 (feed): a within-limit feed round-trips in newest-first order', async () => {
    const feedArb = fc
      .uniqueArray(fc.integer({ min: 0, max: 4_000_000_000_000 }), { maxLength: MAX_FEED_POSTS })
      .map((timestamps) =>
        timestamps.map((ts, i) => ({
          id: `post-${i}`,
          author_id: 'author',
          content: `content-${i}`,
          image_url: null,
          likes_count: 0,
          comments_count: 0,
          shares_count: 0,
          created_at: new Date(ts).toISOString(),
        }))
      );

    await fc.assert(
      fc.asyncProperty(feedArb, async (posts) => {
        await cacheFeed(posts);
        const stored = await getCachedFeed();
        const expected = [...posts].sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
        expect(stored).toStrictEqual(expected);
      }),
      { numRuns: 100 }
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Feature: async-storage-offline, Property 4: Cache feed size limit
  // **Validates: Requirements 1.6**
  it('Property 4: cacheFeed keeps at most MAX_FEED_POSTS, the newest by created_at', async () => {
    // Unique timestamps → deterministic ordering with no ties.
    const uniqueTimestamps = fc.uniqueArray(fc.integer({ min: 0, max: 4_000_000_000_000 }), {
      minLength: 0,
      maxLength: MAX_FEED_POSTS + 60,
    });

    await fc.assert(
      fc.asyncProperty(uniqueTimestamps, async (timestamps) => {
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

        expect(stored.length).toBeLessThanOrEqual(MAX_FEED_POSTS);
        expect(stored.length).toBe(Math.min(posts.length, MAX_FEED_POSTS));

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
  // Feature: async-storage-offline, Property 3: Cache error resilience
  // **Validates: Requirements 1.5, 7.1, 7.4**
  it('Property 3: cache helpers never throw and return the fallback on storage/parse failures', async () => {
    const baseKey = fc.string({ minLength: 1, maxLength: 30 }).map((s) => `@san:${s}`);
    const fallbackVal = fc
      .jsonValue()
      .map((v) => JSON.parse(JSON.stringify(v)))
      .filter((v) => v !== null && v !== undefined);

    await fc.assert(
      fc.asyncProperty(
        baseKey,
        fallbackVal,
        fc.constantFrom('read-throws', 'write-throws', 'corrupted-json'),
        async (key, fallback, scenario) => {
          if (scenario === 'read-throws') {
            const spy = jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('boom'));
            const read = await cacheGet(key, fallback);
            expect(read).toStrictEqual(fallback);
            spy.mockRestore();
          } else if (scenario === 'write-throws') {
            const spy = jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('boom'));
            // cacheSet must swallow the error and resolve to undefined.
            await expect(cacheSet(key, fallback)).resolves.toBeUndefined();
            spy.mockRestore();
          } else {
            // Corrupted/unparseable data on disk → fallback, no throw.
            await AsyncStorage.setItem(namespaced(key), '{not-valid-json::');
            const read = await cacheGet(key, fallback);
            expect(read).toStrictEqual(fallback);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
