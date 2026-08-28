import { create } from 'zustand';
import { AppState } from 'react-native';
import { kvGetJSONSync, kvSetJSON } from '../services/kvStore';

// Tiny store that drives the unread badge on the home-tab bell icon.
//
// Source of truth: the notifications cache written by `app/notifications.tsx`
// (`@san:notifications` MMKV key) and a `lastSeenTs` watermark we update when
// the user actually visits the notifications screen.
//
// The badge count is derived: count notifications in the cache whose timestamp
// is greater than `lastSeenTs`. This avoids any extra network calls — the
// badge is computed entirely from data we already fetched for the screen.
//
// Why a Zustand store instead of just useState + useEffect:
//   - The home tab and the notifications screen are sibling screens; we need
//     a shared reactive value that updates the bell badge immediately when
//     the user marks notifications as seen.
//   - Zustand is already used everywhere else in the app, so this keeps the
//     pattern consistent and avoids pulling in another state library.

const NOTIFICATIONS_CACHE_KEY = '@san:notifications';
const LAST_SEEN_KEY = '@san:notif:lastSeenTs';

interface NotificationsCache {
  ts: number;
  data: Array<{ id: string; ts: string }>; // we only care about timestamps here
}

interface NotificationsBadgeState {
  unread: number;
  // Recompute the badge from the MMKV-backed notifications cache + lastSeenTs.
  // Cheap (sync MMKV reads + filter), call freely on mount/focus.
  recompute: () => void;
  // Background-refresh the notifications cache from the server, then
  // recompute. This is what makes the badge show "you have N new" on the
  // home screen WITHOUT the user opening the notifications list first —
  // the only writer of the `@san:notifications` cache used to be the
  // notifications screen itself. Network-backed, so it's async, fire-and-
  // forget, and THROTTLED (see REFRESH_THROTTLE_MS) so rapid home-tab
  // focus events can't hammer the Worker. Does NOT mark anything seen.
  refresh: (opts?: { force?: boolean }) => Promise<void>;
  // Optimistically bump the unread count by `by` (default 1). Used by the
  // realtime bridge when a live `notif.*` ping arrives before the
  // notifications cache (the source `recompute` reads from) has been
  // refetched — so the bell badge updates the instant the event lands
  // rather than only after the user next opens the notifications screen.
  increment: (by?: number) => void;
  // Mark every currently-cached notification as seen. Called by the
  // notifications screen after a successful fetch so the badge clears
  // immediately when the user actually views the list.
  markAllSeen: () => void;
}

function readLastSeenTs(): number {
  try {
    const v = kvGetJSONSync<number | null>(LAST_SEEN_KEY, 0);
    return typeof v === 'number' ? v : 0;
  } catch {
    return 0;
  }
}

function readCachedNotifications(): NotificationsCache | null {
  try {
    return kvGetJSONSync<NotificationsCache | null>(NOTIFICATIONS_CACHE_KEY, null);
  } catch {
    return null;
  }
}

// Count cached notifications newer than the last-seen watermark. Shared by
// the synchronous initial value and `recompute` so they can never drift.
function computeUnread(): number {
  const cache = readCachedNotifications();
  if (!cache?.data) return 0;
  const lastSeen = readLastSeenTs();
  let n = 0;
  for (const item of cache.data) {
    const t = new Date(item.ts).getTime();
    if (Number.isFinite(t) && t > lastSeen) n++;
  }
  return n;
}

// ── MIRROR THE COUNT ONTO THE APP ICON ───────────────────────────────────────
//
// Reported as: on iPhone an unread message normally leaves a number on the app icon even after the push
// is dismissed, and this app shows nothing. It did show nothing — `setBadgeCountAsync` was never called
// anywhere. See the long note on `setOsBadgeCount` in `src/services/pushNotifications.ts` for the full
// account, including the half that needs a Worker deploy rather than an OTA.
//
// Routed through one helper called from every place that changes `unread`, so the icon cannot drift from
// the in-app badge.
//
// ── THIS STORE REPORTS A COMPONENT, NOT THE TOTAL ────────────────────────────
//
// It used to call `setOsBadgeCount` directly, which was wrong in two ways, because the count here comes
// from `computeUnread()` over the notifications feed and that feed's type says what it carries:
//
//     export type NotificationKind = 'like' | 'comment' | 'follow';
//
// Direct messages are not in it. They live in `chatUnreadStore`. So unread DMs never reached the icon —
// three unread messages and no likes showed no number at all, which for a messenger is the main case —
// and `markAllSeen()`'s hard 0 wiped the icon even while messages were still unread.
//
// `src/services/osBadge.ts` now owns the number and sums two independently-reported components. This
// store reports ONLY its own, so it cannot clear the chat contribution. See that file for the rest.
// Lazy `require` rather than `await import` — see the note in osBadge.ts's `flush` for why the dynamic
// form is untestable under babel-jest while working fine on device.
function syncOsBadge(count: number): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { setNotificationsBadgePart } = require('../services/osBadge') as typeof import('../services/osBadge');
    setNotificationsBadgePart(count);
  } catch {
    // Never let the icon badge break the in-app badge.
  }
}

// Throttle window for the background `refresh()`. Home-tab focus can fire
// often (every tab switch back to home); we don't want a Worker round-trip
// each time. ~45s keeps the badge fresh without hammering the server.
const REFRESH_THROTTLE_MS = 45 * 1000;
let lastRefreshAt = 0;

export const useNotificationsBadge = create<NotificationsBadgeState>((set) => ({
  // Compute initial value synchronously so the first render of the bell
  // shows the correct count (no flash of empty badge while a useEffect
  // catches up).
  unread: computeUnread(),

  recompute: () => {
    const unread = computeUnread();
    set({ unread });
    syncOsBadge(unread);
  },

  refresh: async (opts) => {
    const now = Date.now();
    // `force` bypasses the throttle. See `installNotificationsBadgeForegroundRefresh` for the one
    // caller that needs it and why the throttle was silently eating the case it was reported for.
    if (!opts?.force && now - lastRefreshAt < REFRESH_THROTTLE_MS) return;
    // Claim the window BEFORE awaiting so concurrent focus events can't
    // stampede a burst of parallel fetches.
    lastRefreshAt = now;
    try {
      const { fetchAndCacheNotifications } = await import('../services/notificationsFeed');
      const items = await fetchAndCacheNotifications();
      if (items) {
        // Cache is now server-truth → recompute sets the ABSOLUTE unread
        // count, reconciling any transient `increment()` bumps from the
        // realtime bridge. Never additive.
        const unread = computeUnread();
        set({ unread });
        syncOsBadge(unread);
      } else {
        // Network/offline failure wrote nothing — release the throttle so
        // the next home-tab focus can retry rather than waiting the full
        // window. (Not a loop: refresh only fires on focus, not on render
        // or on the unread state change.)
        lastRefreshAt = 0;
      }
    } catch {
      lastRefreshAt = 0;
    }
  },

  markAllSeen: () => {
    const ts = Date.now();
    try { kvSetJSON(LAST_SEEN_KEY, ts); } catch {}
    set({ unread: 0 });
    // Clearing the icon is the half users notice most: opening the notifications screen must take the
    // number off the launcher, not just off the bell.
    syncOsBadge(0);
  },

  increment: (by = 1) => {
    if (!Number.isFinite(by) || by <= 0) return;
    set((s) => {
      const unread = s.unread + by;
      syncOsBadge(unread);
      return { unread };
    });
  },
}));

// Seed the icon from the value computed synchronously above, once, at import. The initial `unread` is
// derived from the MMKV cache and no mutator has run yet, so without this the notifications component
// stays 0 on a cold start until something changes it.
syncOsBadge(useNotificationsBadge.getState().unread);

// ── THE BADGE DID NOT COME BACK WITH THE APP ─────────────────────────────────
//
// Reported as: leave the app, someone writes, the push shows on the home screen, DISMISS the push,
// open the app — and there is no notification indicator.
//
// The dismissal is a red herring, and it is worth saying so plainly because it is the part that looks
// causal. Nothing in the push path touches the watermark: a repo-wide search finds `markAllSeen()`
// called from exactly two places, both in `app/notifications.tsx`, i.e. only when the user actually
// opens the notifications screen. Swiping a system notification away cannot clear this badge.
//
// What actually happens is that the badge never learns about the message at all:
//
//   1. `increment()` is driven by `RealtimeAccountBridge`, which needs the app running and subscribed.
//      With the app away, the push comes from the Worker's server-side fan-out and nothing local runs.
//   2. So the only path that can discover it is `refresh()`, which refetches the notifications cache
//      that `recompute()` derives from.
//   3. `refresh()` was throttled at REFRESH_THROTTLE_MS (45 s) against a MODULE-level `lastRefreshAt`.
//      Module state survives backgrounding, so coming back within 45 s of the last refresh returned
//      immediately without fetching. `recompute()` then read the unchanged cache and produced 0.
//   4. And `refresh()` was only ever called from the bell's `useFocusEffect` on the HOME tab, so
//      returning into the chat list or the profile did not call it even once.
//
// That combination is also why it is intermittent rather than constant: a true cold start resets
// `lastRefreshAt` to 0 and the badge appears, while a backgrounded-then-resumed app inside the window
// silently skips the fetch.
//
// Installed from `app/_layout.tsx` alongside the other `install*` hooks, so it is bound to the app
// rather than to a screen, and a resume into ANY tab updates the badge.
//
// `recompute()` runs first because it is a synchronous MMKV read: if anything did manage to write the
// cache (a still-alive bridge, a previous fetch) the badge is correct before the network is touched.
// The forced `refresh` then reconciles against server truth, and `refresh` itself claims the throttle
// window as it starts, so a rapid background/foreground flap cannot stampede parallel fetches.
// ── AND THE CHAT-LIST COUNTER HAD THE SAME DISEASE, IN A SECOND STORE ────────
//
// Reported after the first fix shipped: still no indicator on resume, "neither in the chat list nor in
// the bottom navigation". Those are a DIFFERENT counter. There are three:
//
//   1. `useChatUnread`         — per-conversation counts on the chat-list rows AND the total on the
//                                bottom bar (`totalChatUnread` in CustomTabBar).
//   2. `useNotificationsBadge` — the bell, and the messages tab glyph.
//   3. the OS app-icon badge   — see `setOsBadgeCount` in services/pushNotifications.ts.
//
// Only (2) was fixed above. (1) is reconciled by exactly one call site — an effect in
// `app/(tabs)/messages.tsx` keyed on `[conversations, user?.id, reconcileUnread]` — so it recomputes
// only when the messages tab is MOUNTED and the conversation list changes IDENTITY. Both conditions
// fail in the reported scenario:
//
//   * resume into any other tab and the effect does not exist to run;
//   * resume into messages and `syncConversations` is throttled at 3 minutes against a persisted
//     stamp, so it returns without fetching, `conversations` keeps its identity, and the effect does
//     not re-fire. `reconcile` compares `lastMessageAt` against the read watermark, so with no fetch
//     there is no newer timestamp to notice.
//
// Same shape as the bell, then: a throttle that survives backgrounding plus a screen-scoped trigger.
// The fix is the same too — force the fetch on resume and reconcile from here, where it is bound to the
// app rather than to a screen. `resetThrottle` is the mechanism pull-to-refresh already uses, so this
// borrows an existing seam instead of adding a `force` flag to every sync function.
//
// Ordering matters: `syncConversations` must land BEFORE `reconcile`, because reconcile reads the rows.
// It is awaited rather than fired alongside for exactly that reason.
async function refreshChatUnreadOnResume(): Promise<void> {
  try {
    const { useAuthStore } = await import('./authStore');
    const uid = useAuthStore.getState().user?.id;
    if (!uid) return;
    const [{ syncConversations }, { resetThrottle }, { useChatUnread }, { useEntityStore }] =
      await Promise.all([
        import('../services/syncService'),
        import('../services/syncThrottle'),
        import('./chatUnreadStore'),
        import('../services/entityStore'),
      ]);
    // Resume is exactly the moment the 3-minute window is wrong: the app was away, so "recently
    // synced" says nothing about whether anything arrived.
    resetThrottle(`conversations:${uid}`);
    await syncConversations(uid);
    const rows = useEntityStore.getState().conversations || [];
    if (rows.length > 0) useChatUnread.getState().reconcile(rows as any, uid);
  } catch {
    // Offline, signed out, or a transport failure. The counters simply stay as they were.
  }
}

function runBadgeRefreshPass(): void {
  try {
    const s = useNotificationsBadge.getState();
    s.recompute();
    void s.refresh({ force: true });
    // The chat-list / bottom-bar counter is a separate store with the same resume hole — see above.
    void refreshChatUnreadOnResume();
  } catch {
    // A badge that fails to refresh must never be able to take the app down.
  }
}

export function installNotificationsBadgeForegroundRefresh(): () => void {
  const sub = AppState.addEventListener('change', (next) => {
    if (next !== 'active') return;
    runBadgeRefreshPass();
  });

  // ── A COLD START IS NOT A RESUME, AND ONLY THE RESUME WAS HANDLED ───────────
  //
  // Reported four times, each time more precisely: the app is fully closed, messages arrive, the app is
  // opened — and neither the chat-list row badge nor the bottom-bar counter shows anything. Background
  // the app and come back and they appear. "It only counts while I am inside the app."
  //
  // `AppState.addEventListener('change')` fires on a TRANSITION. On a cold start the app is already
  // `active` by the time this runs, so no transition occurs and the listener above never fires. Every
  // path that could notice the missed messages hangs off it:
  //
  //   • `reconcile` is called from exactly one place in the codebase — `refreshChatUnreadOnResume`,
  //     reached only from that listener. On a fresh launch it therefore never runs at all, and
  //     `reconcile` is the ONLY mechanism that can turn "the newest message is newer than my read
  //     watermark" into a count. Realtime `bump` cannot: it requires the app to have been listening when
  //     the message arrived, which is exactly what a closed app was not doing.
  //   • the bell's `recompute` / forced `refresh` had the same hole, one store over.
  //
  // So the counters were not slow or throttled on launch, they were unreachable, and backgrounding the
  // app was the user's accidental workaround for a missing call.
  //
  // Running the same pass once at install fixes both stores with the code that already exists. It is
  // deliberately the SAME function as the listener body rather than a launch-specific variant — a second
  // path here is how the two would drift, and the resume version is already correct about throttles
  // (`resetThrottle` before `syncConversations`) and about ordering (`await` before `reconcile`).
  //
  // Not gated behind `InteractionManager`: everything it touches is behind a dynamic import and a
  // network call, so nothing here occupies the first frame, and a deferral is what made the equivalent
  // paths elsewhere in this app paint stale empty states.
  if (AppState.currentState === 'active') runBadgeRefreshPass();

  return () => {
    try { sub.remove(); } catch {}
  };
}
