import { create } from 'zustand';

// ─── Constants ───────────────────────────────────────────────────────────────

const PING_URL = 'https://www.google.com/generate_204';
const PING_TIMEOUT = 3000;

// Base poll cadence. On a stable connection the effective interval backs off
// (see BACKOFF_* below) to cut battery/radio/heat cost; it snaps back to this
// base the moment a real online↔offline change is detected.
const POLL_INTERVAL = 30000;

// Adaptive back-off: after the online state has been UNCHANGED for
// BACKOFF_STABLE_THRESHOLD consecutive checks, step the effective interval up
// to BACKOFF_INTERVAL_1; after twice that many, up to BACKOFF_INTERVAL_2 (cap).
const BACKOFF_STABLE_THRESHOLD = 5;
const BACKOFF_INTERVAL_1 = 60000; // 60s
const BACKOFF_INTERVAL_2 = 120000; // 120s (cap)

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ConnectivityState {
  isOnline: boolean;
  lastChecked: string | null;
  start: () => void;
  stop: () => void;
  checkNow: () => Promise<boolean>;
}

// ─── Module State ────────────────────────────────────────────────────────────

// Single self-rescheduling timer handle. Acts as the start()/stop() guard:
// non-null means the poll loop is live (matches the old setInterval semantics).
let timeoutId: ReturnType<typeof setTimeout> | null = null;

// Count of consecutive checks where the online state did NOT change. Drives the
// adaptive back-off; reset to 0 on any detected change so reactions stay fast.
let stableCount = 0;

// ─── Connectivity Check ──────────────────────────────────────────────────────

async function checkConnectivity(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PING_TIMEOUT);
    const response = await fetch(PING_URL, {
      method: 'HEAD',
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timeoutId);
    // Google's generate_204 returns 204, any response means online
    return response.status === 204 || response.ok;
  } catch {
    return false;
  }
}

// ─── Lazy import to avoid circular dependency ────────────────────────────────

async function triggerProcessQueue(): Promise<void> {
  try {
    const { processQueue } = await import('./offlineQueue');
    await processQueue();
  } catch {
    // offlineQueue may not be available yet or processQueue failed — ignore
  }
}

// ─── Adaptive interval ────────────────────────────────────────────────────────

// Effective delay before the next poll, derived from how long the state has
// been stable. Stable longer → poll less often (battery/radio savings).
function nextInterval(): number {
  if (stableCount >= BACKOFF_STABLE_THRESHOLD * 2) return BACKOFF_INTERVAL_2;
  if (stableCount >= BACKOFF_STABLE_THRESHOLD) return BACKOFF_INTERVAL_1;
  return POLL_INTERVAL;
}

// ─── Store ───────────────────────────────────────────────────────────────────

export const useConnectivityStore = create<ConnectivityState>((set, get) => {
  // One poll cycle: check, update state, track stability for back-off, and
  // drain the queue on an offline → online transition.
  const performCheck = async (): Promise<void> => {
    const prev = get().isOnline;
    const online = await checkConnectivity();
    set({ isOnline: online, lastChecked: new Date().toISOString() });
    if (online === prev) {
      // No change — let the interval back off.
      stableCount += 1;
    } else {
      // Real connectivity change — reset to the base interval so we stay snappy.
      stableCount = 0;
    }
    if (!prev && online) {
      triggerProcessQueue();
    }
  };

  // Self-rescheduling loop. Reschedules only while the loop is live (timeoutId
  // not cleared by stop()), at the current adaptive interval.
  const scheduleNext = (): void => {
    timeoutId = setTimeout(async () => {
      await performCheck();
      // stop() may have run during the in-flight check — only reschedule if not.
      if (timeoutId !== null) {
        scheduleNext();
      }
    }, nextInterval());
  };

  return {
    isOnline: true,
    lastChecked: null,

    start: () => {
      if (timeoutId) return;

      // Fresh session starts at the base cadence.
      stableCount = 0;

      // Drain any leftover queue from a previous session immediately. The
      // queue can carry mutations from a session that was killed before
      // it ever transitioned offline → online (the only edge the polling
      // loop below reacts to). Without this kick the items would sit in
      // AsyncStorage until the next time the device actually goes
      // offline-and-back, which on a stable connection might never happen.
      triggerProcessQueue();

      // Check immediately on start
      checkConnectivity().then((online) => {
        const prev = get().isOnline;
        set({ isOnline: online, lastChecked: new Date().toISOString() });
        if (!prev && online) {
          triggerProcessQueue();
        }
      });

      // Kick off the adaptive poll loop (base 30s, backing off to 60s then
      // 120s while the connection stays stable; resets to 30s on any change).
      scheduleNext();
    },

    stop: () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    },

    checkNow: async () => {
      const prev = get().isOnline;
      const online = await checkConnectivity();
      set({ isOnline: online, lastChecked: new Date().toISOString() });
      if (!prev && online) {
        triggerProcessQueue();
      }
      return online;
    },
  };
});
