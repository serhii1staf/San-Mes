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
//
// Perf note (account-switcher freeze fix): the synchronous portion is
// kept tight — namespace switch + 4× setState wipes + blocked-users reset
// — so the JS thread can return to the event loop fast and the caller
// (AccountSwitcher.tsx) can paint its splash cover. The heavy work
// (entityStore.hydrate, blockedUsersStore.hydrate, disconnectRealtime)
// is deferred via InteractionManager so it never lands on the same
// frame as the account-switcher tap. In production this work is
// largely wasted because the caller fires `Updates.reloadAsync()`
// ~280 ms later — but keeping it gives the dev-client / fallback
// path a working state when reload isn't available, without
// reintroducing the freeze.

import { InteractionManager } from 'react-native';

import { setCacheAccount } from './cacheService';
import { setThrottleAccount, resetAllThrottles } from './syncThrottle';
import { useEntityStore } from './entityStore';
import { useFeedStore } from '../store/feedStore';
import { useChatStore } from '../store/chatStore';
import { useBlockedUsersStore } from '../store/blockedUsersStore';
import { disconnectRealtime } from './realtime/ably';

export function switchAccount(accountId: string | null | undefined): void {
  // 1) Re-scope storage to the new account (synchronous, sub-ms).
  setCacheAccount(accountId);
  setThrottleAccount(accountId);
  try { resetAllThrottles?.(); } catch {}

  // 2) Wipe in-memory state from the previous account. These are pure
  //    setState calls that fan out to subscribers — they're cheap on
  //    their own but together they trigger zustand notifications across
  //    every screen subscribed to those stores. Keep them synchronous so
  //    the next paint never observes mixed account data.
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

  // 3) Defer the heavy work past the next interaction frame so the
  //    caller's splash cover can paint first. entityStore.hydrate()
  //    parses the new account's full posts/profiles/conversations
  //    cache (multi-KB JSON.parse) and disconnectRealtime() closes
  //    the Ably WebSocket — running them inline on the tap thread
  //    was the dominant cost behind the "tap → app freezes" symptom.
  //    Putting them behind InteractionManager keeps the tap-handler
  //    frame at sub-16 ms even on weak devices.
  InteractionManager.runAfterInteractions(() => {
    try { useEntityStore.getState().hydrate(); } catch {}
    try { useBlockedUsersStore.getState().hydrate(); } catch {}
    // 4) Drop the realtime client. The next consumer (chat screen, global
    //    notification bridge) will lazily reopen it with the new auth.
    try { disconnectRealtime(); } catch {}
  });
}
