// Writes to the two post caches the feed and profile actually read.
//
// THE BUG THIS FIXES
//   The feed reads its cache through `kvStore` (`kvGetJSONSync(FEED_CACHE_KEY)`).
//   When MMKV is available — i.e. in every real build — `kvStore` reads and writes
//   MMKV ONLY; AsyncStorage is just a fallback for when MMKV is missing.
//
//   Meanwhile the create screen and the admin screen wrote "the same" caches
//   directly through `AsyncStorage.setItem(accountKey('@san:feed_posts'), …)`.
//   Those are two unrelated stores. So a post the user had just created was
//   written somewhere the feed never looks: the feed kept rendering its previous
//   list, and only the network response eventually corrected it.
//
//   That is precisely the "content is missing, then wrong, then right" cycle, and
//   the reason it felt like the app was constantly reloading — every visit had to
//   wait for the network to fix a cache that was silently being written to the
//   wrong place.
//
// KEY SCOPING — easy to get wrong
//   `kvSetJSON` / `kvGetJSONSync` take a BASE key and apply `accountKey()`
//   internally. The old call sites applied `accountKey()` themselves, so passing
//   their pre-scoped key here would double-prefix it and silently miss again.
//   These functions take base keys, and per-account isolation is unchanged.

import { kvGetJSONSync, kvSetJSON } from './kvStore';

/** Base keys — NOT account-scoped here; `kvStore` does that. */
export const FEED_POSTS_KEY = '@san:feed_posts';
export const MY_POSTS_KEY = '@san:my_posts';

/** How many posts each cache retains. Matches what the feed hydrates. */
export const POST_CACHE_LIMIT = 20;

const CACHE_KEYS = [FEED_POSTS_KEY, MY_POSTS_KEY] as const;

interface CachedPostLike {
  id: string;
}

/**
 * Put a freshly created post at the head of both caches.
 *
 * Deduplicates by id so an optimistic insert followed by a server echo cannot
 * produce the same post twice — a duplicate key in the list would make FlashList
 * recycle incorrectly, reintroducing the wrong-content symptom from a different
 * direction.
 */
export function prependToPostCaches(post: CachedPostLike): void {
  for (const key of CACHE_KEYS) {
    try {
      const existing = kvGetJSONSync<CachedPostLike[]>(key, []) || [];
      const deduped = existing.filter((p) => p && p.id !== post.id);
      kvSetJSON(key, [post, ...deduped].slice(0, POST_CACHE_LIMIT));
    } catch {
      // A cache write is best-effort: the post is already on the server, and the
      // next fetch will repopulate. Never let this break the publish flow.
    }
  }
}

/** Merge a patch into a cached post in both caches. No-op if absent. */
export function updateInPostCaches(postId: string, patch: Record<string, unknown>): void {
  for (const key of CACHE_KEYS) {
    try {
      const existing = kvGetJSONSync<CachedPostLike[]>(key, []) || [];
      if (existing.length === 0) continue;
      let changed = false;
      const next = existing.map((p) => {
        if (p && p.id === postId) {
          changed = true;
          return { ...p, ...patch };
        }
        return p;
      });
      // Skip the write when nothing matched, so an unrelated edit does not
      // rewrite the blob and invalidate the feed's content-equality check.
      if (changed) kvSetJSON(key, next);
    } catch {
      /* best-effort */
    }
  }
}

/** Drop a post from both caches. */
export function removeFromPostCaches(postId: string): void {
  for (const key of CACHE_KEYS) {
    try {
      const existing = kvGetJSONSync<CachedPostLike[]>(key, []) || [];
      if (existing.length === 0) continue;
      const next = existing.filter((p) => p && p.id !== postId);
      if (next.length !== existing.length) kvSetJSON(key, next);
    } catch {
      /* best-effort */
    }
  }
}
