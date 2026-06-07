// Centralised account switching.
//
// On login / logout / account change we MUST:
//   1. Point the cache namespace + throttle at the new account FIRST.
//   2. Clear all in-memory stores so the previous account's feed/profile/chats
//      can never bleed into the new account for even one frame.
//   3. Re-hydrate the new account's data from its own (namespaced) cache.
//
// Keeping this in one place guarantees every entry point behaves identically.

import { setCacheAccount } from './cacheService';
import { setThrottleAccount, resetAllThrottles } from './syncThrottle';
import { useEntityStore } from './entityStore';
import { useFeedStore } from '../store/feedStore';
import { useChatStore } from '../store/chatStore';

export function switchAccount(accountId: string | null | undefined): void {
  // 1) Re-scope storage to the new account.
  setCacheAccount(accountId);
  setThrottleAccount(accountId);
  try { resetAllThrottles?.(); } catch {}

  // 2) Wipe in-memory state from the previous account.
  try {
    useFeedStore.setState({ posts: [], profilePosts: [], feedScrollOffset: 0, profileScrollOffset: 0, lastFeedFetch: null, lastProfileFetch: null });
  } catch {}
  try {
    useChatStore.setState({ conversations: [], messages: {} });
  } catch {}
  try {
    useEntityStore.setState({ posts: {}, profiles: {}, likes: {}, follows: {}, conversations: [], feedIds: [], myPostIds: [], isHydrated: false } as any);
  } catch {}

  // 3) Re-hydrate the new account's own cached data.
  try { useEntityStore.getState().hydrate(); } catch {}
}
