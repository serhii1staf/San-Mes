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
  createdAt: fc.date({ noInvalidDate: true }).map((d) => d.toISOString()),
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
  //
  // UPDATED (app-wide-degradation-fixes, block G): this used to assert `toBe`, i.e.
  // that the store holds the very array instance that was passed in.
  //
  // `setPosts` now bails out when the incoming list is content-equal to what is
  // already stored, keeping the PREVIOUS reference so React can skip the re-render.
  // That is the fix for screens blinking and rebuilding on every focus and sync
  // tick, and the feed's own call sites already worked this way
  // (`setPosts(prev => equal ? prev : parsed)`) — the store setter just makes it
  // impossible to forget.
  //
  // So reference identity was an implementation detail, not the requirement. What
  // this property actually guarantees — the store holds exactly the data you set,
  // with no copy, no reordering and no round-trip — is asserted below on content.
  it('Property 1: setPosts stores exactly the data given (data preserved between tabs)', () => {
    fc.assert(
      fc.property(uniquePostsArb(0, 12), (posts) => {
        resetStore();
        useFeedStore.getState().setPosts(posts);

        const stored = useFeedStore.getState().posts;
        expect(stored).toEqual(posts);
        expect(stored.length).toBe(posts.length);
        // Order is part of the contract: the feed renders in array order.
        expect(stored.map((p) => p.id)).toEqual(posts.map((p) => p.id));
      }),
      { numRuns: 100 }
    );
  });

  // Companion to Property 1: the bail-out itself.
  //
  // Setting content-equal data must NOT produce a new reference, because that
  // reference change is precisely what re-rendered every subscriber and busted
  // `React.memo` on every card.
  it('Property 1b: re-setting content-equal posts keeps the previous reference', () => {
    fc.assert(
      fc.property(uniquePostsArb(1, 8), (posts) => {
        resetStore();
        useFeedStore.getState().setPosts(posts);
        const first = useFeedStore.getState().posts;

        // A structurally identical but distinct array — what a refetch produces.
        useFeedStore.getState().setPosts(posts.map((p) => ({ ...p })));
        expect(useFeedStore.getState().posts).toBe(first);

        // A real change must still land.
        useFeedStore.getState().setPosts(
          posts.map((p, i) => (i === 0 ? { ...p, content: `${p.content}#changed` } : { ...p })),
        );
        expect(useFeedStore.getState().posts).not.toBe(first);
        expect(useFeedStore.getState().posts[0].content).toContain('#changed');
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
