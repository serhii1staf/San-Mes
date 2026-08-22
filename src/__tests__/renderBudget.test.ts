/**
 * Frame-budget and recycling-pool tests.
 *
 * The single most important assertion here is the PRESERVATION one: a modern
 * device with Low Power Mode off must receive byte-for-byte today's settings. A
 * perf change that silently downgrades healthy devices is worse than no change,
 * and it is the kind of regression nobody notices until the reviews arrive.
 */

import fc from 'fast-check';
import {
  BASELINE_BUDGET,
  LOW_POWER_BUDGET,
  renderBudget,
  WEAK_DEVICE_BUDGET,
} from '../utils/renderBudget';
import type { PowerMode } from '../services/powerMode';
import { countPostImages, feedGetItemType } from '../lib/feedItemType';
import type { Post } from '../types';

const ALL_MODES: PowerMode[] = ['unknown', 'normal', 'low_power'];

describe('renderBudget', () => {
  it('leaves healthy devices exactly as they are today', () => {
    for (const powerMode of ['unknown', 'normal'] as const) {
      expect(renderBudget({ isWeak: false, powerMode })).toEqual(BASELINE_BUDGET);
    }
  });

  /**
   * `unknown` is the state of every binary already installed, because the
   * expo-battery native module is not in them. An OTA bundle must therefore behave
   * identically for those users — degrading on `unknown` would change behaviour for
   * the entire existing install base with no way to tell.
   */
  it('treats unknown as "behave exactly as before", not as low power', () => {
    expect(renderBudget({ isWeak: false, powerMode: 'unknown' })).toEqual(BASELINE_BUDGET);
    expect(renderBudget({ isWeak: false, powerMode: 'unknown' })).not.toEqual(LOW_POWER_BUDGET);
  });

  it('applies the invisible reductions on weak hardware', () => {
    for (const powerMode of ['unknown', 'normal'] as const) {
      expect(renderBudget({ isWeak: true, powerMode })).toEqual(WEAK_DEVICE_BUDGET);
    }
  });

  /**
   * A weak device must NOT get a different-looking app.
   *
   * An earlier version switched glass, blur and particles off by device class. That
   * is a silent redesign for a whole class of hardware — immediately visible, since
   * the glass and fallback paths differ in corner treatment and surface size — and
   * nobody asked for it. Older phones should run smoothly, not look different.
   */
  it('never changes the visual design based on device class alone', () => {
    for (const powerMode of ['unknown', 'normal'] as const) {
      const b = renderBudget({ isWeak: true, powerMode });
      expect(b.glassAllowed).toBe(true);
      expect(b.fadingBlurAllowed).toBe(true);
      expect(b.ambientParticles).toBe(true);
    }
  });

  it('reduces in low power mode even on strong hardware', () => {
    expect(renderBudget({ isWeak: false, powerMode: 'low_power' })).toEqual(LOW_POWER_BUDGET);
  });

  /**
   * Low Power Mode is the one case where dropping visible effects is justified: the
   * OS has already cut the CPU/GPU budget and capped the refresh rate, the user
   * chose the state, and it ends when they charge the phone.
   */
  it('drops visible effects only in low power mode', () => {
    const lp = renderBudget({ isWeak: false, powerMode: 'low_power' });
    expect(lp.glassAllowed).toBe(false);
    expect(lp.fadingBlurAllowed).toBe(false);
    expect(lp.ambientParticles).toBe(false);
  });

  it('lets low power mode win over device class', () => {
    expect(renderBudget({ isWeak: true, powerMode: 'low_power' })).toEqual(LOW_POWER_BUDGET);
  });

  it('never makes any dimension heavier when degrading', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.constantFrom(...ALL_MODES), (isWeak, powerMode) => {
        const b = renderBudget({ isWeak, powerMode });
        expect(b.drawDistance).toBeLessThanOrEqual(BASELINE_BUDGET.drawDistance);
        expect(b.heroWarmCount).toBeLessThanOrEqual(BASELINE_BUDGET.heroWarmCount);
        expect(b.carouselEagerSlides).toBeLessThanOrEqual(BASELINE_BUDGET.carouselEagerSlides);
        // A boolean may go true→false, never false→true.
        if (!BASELINE_BUDGET.glassAllowed) expect(b.glassAllowed).toBe(false);
        if (!BASELINE_BUDGET.ambientParticles) expect(b.ambientParticles).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('is total and returns one of the three known budgets', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.constantFrom(...ALL_MODES), (isWeak, powerMode) => {
        const b = renderBudget({ isWeak, powerMode });
        expect([BASELINE_BUDGET, WEAK_DEVICE_BUDGET, LOW_POWER_BUDGET]).toContainEqual(b);
      }),
      { numRuns: 100 },
    );
  });

  it('actually halves the pre-render window when degrading', () => {
    // Guards against a token reduction that looks like mitigation but does not
    // meaningfully cut the decode burst a fling triggers.
    for (const b of [WEAK_DEVICE_BUDGET, LOW_POWER_BUDGET]) {
      expect(b.drawDistance).toBeLessThanOrEqual(BASELINE_BUDGET.drawDistance / 2);
      expect(b.heroWarmCount).toBeLessThanOrEqual(BASELINE_BUDGET.heroWarmCount / 2);
      // And it must skip the eager decode, which is the expensive half.
      expect(b.warmCachePolicy).toBe('disk');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────

const basePost = (over: Partial<Post> = {}): Post =>
  ({
    id: 'p1',
    authorId: 'a1',
    authorName: 'A',
    authorUsername: 'a',
    authorEmoji: '😊',
    content: '',
    likesCount: 0,
    commentsCount: 0,
    sharesCount: 0,
    isLiked: false,
    isBookmarked: false,
    createdAt: '2026-01-01T00:00:00Z',
    isRepost: false,
    ...over,
  }) as Post;

describe('feedGetItemType', () => {
  it('counts images the same way PostCard does', () => {
    expect(countPostImages({ imageUrls: undefined, imageUrl: undefined })).toBe(0);
    expect(countPostImages({ imageUrls: undefined, imageUrl: 'a' })).toBe(1);
    expect(countPostImages({ imageUrls: [], imageUrl: 'a' })).toBe(1);
    expect(countPostImages({ imageUrls: ['a', 'b'], imageUrl: 'a' })).toBe(2);
  });

  it('separates the five card shapes', () => {
    expect(feedGetItemType(basePost())).toBe('text');
    expect(feedGetItemType(basePost({ imageUrl: 'a' }))).toBe('image');
    expect(feedGetItemType(basePost({ imageUrls: ['a', 'b'] }))).toBe('carousel');
    expect(feedGetItemType(basePost({ imageUrl: 'a', isSpoilerImage: true }))).toBe('spoiler');
    expect(
      feedGetItemType(basePost({ isRepost: true, originalPost: basePost({ id: 'p0' }) })),
    ).toBe('repost');
  });

  it('does not call a post a spoiler when it has no image', () => {
    // PostCard's `hasSpoiler` requires images, so the pool must agree — otherwise a
    // text post lands in the spoiler pool and gets recycled into a shape it never
    // renders.
    expect(feedGetItemType(basePost({ isSpoilerImage: true }))).toBe('text');
  });

  it('prefers the repost shape over the image shape', () => {
    // PostCard checks `isRepost && originalPost` first; the subtree is the embedded
    // quote card regardless of images.
    expect(
      feedGetItemType(
        basePost({ isRepost: true, originalPost: basePost({ id: 'p0' }), imageUrls: ['a', 'b'] }),
      ),
    ).toBe('repost');
  });

  it('ignores isRepost without an originalPost', () => {
    // Matches PostCard: the embed only renders when the original resolved.
    expect(feedGetItemType(basePost({ isRepost: true, imageUrl: 'a' }))).toBe('image');
  });

  it('is total and deterministic', () => {
    fc.assert(
      fc.property(
        fc.record({
          images: fc.array(fc.string({ minLength: 1 }), { maxLength: 4 }),
          single: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
          isRepost: fc.boolean(),
          hasOriginal: fc.boolean(),
          isSpoilerImage: fc.boolean(),
        }),
        ({ images, single, isRepost, hasOriginal, isSpoilerImage }) => {
          const post = basePost({
            imageUrls: images.length > 0 ? images : undefined,
            imageUrl: single,
            isRepost,
            originalPost: hasOriginal ? basePost({ id: 'orig' }) : undefined,
            isSpoilerImage,
          });
          const a = feedGetItemType(post);
          const b = feedGetItemType(post);
          expect(a).toBe(b);
          expect(['repost', 'spoiler', 'text', 'image', 'carousel']).toContain(a);
        },
      ),
      { numRuns: 200 },
    );
  });
});
