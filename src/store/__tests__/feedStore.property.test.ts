import fc from 'fast-check';
import { useFeedStore } from '../feedStore';
import type { Post } from '../../types';

// Property-based tests for feedStore invariants (app-ux-improvements spec).
//
// These exercise the Zustand store that backs tab-state persistence:
//   - setPosts(posts) stores the array as-is (data preserved between tabs)
//   - updatePost(id, data) merges fields into matching posts without duplicating
//
// Convention: tag every property test with a comment identifying the feature
// and the numbered property from design.md, and run >= 100 iterations.

// Minimal Post generator covering the required shape.
const postArb: fc.Arbitrary<Post> = fc.record({
  id: fc.uuid(),
  authorId: fc.uuid(),
  authorName: fc.string({ maxLength: 20 }),
  authorUsername: fc.string({ maxLength: 20 }),
  content: fc.string({ maxLength: 100 }),
  likesCount: fc.integer({ min: 0, max: 10000 }),
  commentsCount: fc.integer({ min: 0, max: 10000 }),
  sharesCount: fc.integer({ min: 0, max: 10000 }),
  isLiked: fc.boolean(),
  isBookmarked: fc.boolean(),
  createdAt: fc.date().map((d) => d.toISOString()),
});

// A list of posts with unique ids so id-based lookups are unambiguous.
const uniquePostsArb = (min = 0, max = 12): fc.Arbitrary<Post[]> =>
  fc.uniqueArray(postArb, {
    minLength: min,
    maxLength: max,
    selector: (p) => p.id,
  });

const resetStore = () => {
  useFeedStore.setState({ posts: [], profilePosts: [] });
};

describe('feedStore property invariants', () => {
  beforeEach(() => {
    resetStore();
  });

  // Feature: app-ux-improvements, Property 1: Инвариант store — сохранение данных между табами
  it('Property 1: setPosts stores the exact same array (data preserved between tabs)', () => {
    fc.assert(
      fc.property(uniquePostsArb(0, 12), (posts) => {
        resetStore();
        useFeedStore.getState().setPosts(posts);

        const stored = useFeedStore.getState().posts;
        // Same reference and same contents — no network round-trip, no copy.
        expect(stored).toBe(posts);
        expect(stored).toEqual(posts);
        expect(stored.length).toBe(posts.length);
      }),
      { numRuns: 100 }
    );
  });

  // Feature: app-ux-improvements, Property 2: Идемпотентность updatePost
  it('Property 2: double updatePost(id, data) is identical to a single call and never duplicates', () => {
    fc.assert(
      fc.property(
        uniquePostsArb(1, 12),
        fc.record({
          content: fc.string({ maxLength: 100 }),
          likesCount: fc.integer({ min: 0, max: 10000 }),
        }),
        fc.nat(),
        (posts, data, idx) => {
          const target = posts[idx % posts.length];

          // Baseline: apply updatePost exactly once.
          useFeedStore.setState({ posts: [...posts], profilePosts: [...posts] });
          useFeedStore.getState().updatePost(target.id, data);
          const single = useFeedStore.getState().posts;
          const singleProfile = useFeedStore.getState().profilePosts;

          // Apply updatePost twice from the same starting state.
          useFeedStore.setState({ posts: [...posts], profilePosts: [...posts] });
          useFeedStore.getState().updatePost(target.id, data);
          useFeedStore.getState().updatePost(target.id, data);
          const doubled = useFeedStore.getState().posts;
          const doubledProfile = useFeedStore.getState().profilePosts;

          // Idempotent: double call equals single call in both arrays.
          expect(doubled).toEqual(single);
          expect(doubledProfile).toEqual(singleProfile);

          // No duplication: exactly one post with the target id, length unchanged.
          expect(doubled.filter((p) => p.id === target.id).length).toBe(1);
          expect(doubled.length).toBe(posts.length);

          // The merged fields are present on the target post.
          const updated = doubled.find((p) => p.id === target.id)!;
          expect(updated.content).toBe(data.content);
          expect(updated.likesCount).toBe(data.likesCount);
        }
      ),
      { numRuns: 100 }
    );
  });
});
