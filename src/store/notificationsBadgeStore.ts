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
    set({ unread: computeUnread() });
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
        set({ unread: computeUnread() });
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
  },

  increment: (by = 1) => {
    if (!Number.isFinite(by) || by <= 0) return;
    set((s) => ({ unread: s.unread + by }));
  },
}));

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
export function installNotificationsBadgeForegroundRefresh(): () => void {
  const sub = AppState.addEventListener('change', (next) => {
    if (next !== 'active') return;
    try {
      const s = useNotificationsBadge.getState();
      s.recompute();
      void s.refresh({ force: true });
    } catch {
      // A badge that fails to refresh must never be able to take the app down on resume.
    }
  });
  return () => {
    try { sub.remove(); } catch {}
  };
}
