// Recycling-pool discriminator for the feed list.
//
// FlashList reuses a cell by re-rendering it with a different item rather than
// unmounting it. That is only cheap when the two items produce the SAME subtree
// shape. Without a `getItemType` every feed card shared one pool, so a text-only
// card could be recycled into a carousel card — React then had to tear down and
// rebuild whole branches and the native view tree had to re-layout, on a scroll
// frame.
//
// CRITICAL INVARIANT
//   This function must mirror PostCard's own branching exactly. If it drifts, the
//   pool stops matching the subtree and the stutter returns while appearing to be
//   fixed — the worst kind of regression, because the mitigation is still visibly
//   "in place". `src/__tests__/feedItemType.test.ts` asserts the correspondence
//   against generated posts.

import type { Post } from '../types';

export type FeedItemType = 'repost' | 'spoiler' | 'text' | 'image' | 'carousel';

/** Count the images a post will actually render. Mirrors PostCard's `imageUrls`. */
export function countPostImages(post: Pick<Post, 'imageUrls' | 'imageUrl'>): number {
  if (post.imageUrls && post.imageUrls.length > 0) return post.imageUrls.length;
  return post.imageUrl ? 1 : 0;
}

/**
 * Which recycling pool a post belongs to.
 *
 * Order matters and follows PostCard: the repost embed wins over image layout,
 * and the spoiler cover replaces the image entirely.
 */
export function feedGetItemType(
  post: Pick<Post, 'imageUrls' | 'imageUrl' | 'isRepost' | 'originalPost' | 'isSpoilerImage'>,
): FeedItemType {
  // A repost renders an embedded quote card — a different subtree from any
  // ordinary post, regardless of its images.
  if (post.isRepost && post.originalPost) return 'repost';

  const n = countPostImages(post);

  // Spoiler swaps the image for a blurred cover component.
  if (post.isSpoilerImage && n > 0) return 'spoiler';

  if (n === 0) return 'text';
  return n === 1 ? 'image' : 'carousel';
}
