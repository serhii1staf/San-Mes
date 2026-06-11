import { create } from 'zustand';
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

export const useNotificationsBadge = create<NotificationsBadgeState>((set) => ({
  unread: (() => {
    // Compute initial value synchronously so the first render of the bell
    // shows the correct count (no flash of empty badge while a useEffect
    // catches up).
    const cache = readCachedNotifications();
    if (!cache?.data) return 0;
    const lastSeen = readLastSeenTs();
    let n = 0;
    for (const item of cache.data) {
      const t = new Date(item.ts).getTime();
      if (Number.isFinite(t) && t > lastSeen) n++;
    }
    return n;
  })(),

  recompute: () => {
    const cache = readCachedNotifications();
    if (!cache?.data) {
      set({ unread: 0 });
      return;
    }
    const lastSeen = readLastSeenTs();
    let n = 0;
    for (const item of cache.data) {
      const t = new Date(item.ts).getTime();
      if (Number.isFinite(t) && t > lastSeen) n++;
    }
    set({ unread: n });
  },

  markAllSeen: () => {
    const ts = Date.now();
    try { kvSetJSON(LAST_SEEN_KEY, ts); } catch {}
    set({ unread: 0 });
  },
}));
