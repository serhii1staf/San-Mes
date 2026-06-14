// Centralised account switching.
//
// On login / logout / account change we MUST:
//   1. Point the cache namespace + throttle at the new account FIRST.
//   2. Clear all in-memory stores so the previous account's feed/profile/chats
//      can never bleed into the new account for even one frame.
//   3. Re-hydrate the new account's data from its own (namespaced) cache.
//   4. Tear down the realtime connection — the next call to getRealtime()
//      from any consumer will reopen with the new account's clientId, so
//      stale chat:* subscriptions don't leak into another user's session.
//
// Keeping this in one place guarantees every entry point behaves identically.

import { setCacheAccount } from './cacheService';
import { setThrottleAccount, resetAllThrottles } from './syncThrottle';
import { useEntityStore } from './entityStore';
import { useFeedStore } from '../store/feedStore';
import { useChatStore } from '../store/chatStore';
import { useBlockedUsersStore } from '../store/blockedUsersStore';
import { disconnectRealtime } from './realtime/ably';

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

  // 2b) Drop the previous account's blocked-users list from memory before
  //     the new account's hydrate fires. Without this, the new account
  //     would briefly observe the previous account's block list (one
  //     frame) which could surface as a flash of "hidden" placeholders
  //     over the new account's content.
  try { useBlockedUsersStore.getState().reset(); } catch {}

  // 3) Re-hydrate the new account's own cached data.
  try { useEntityStore.getState().hydrate(); } catch {}
  try { useBlockedUsersStore.getState().hydrate(); } catch {}

  // 4) Drop the realtime client. The next consumer (chat screen, global
  //    notification bridge) will lazily reopen it with the new auth.
  try { disconnectRealtime(); } catch {}
}
