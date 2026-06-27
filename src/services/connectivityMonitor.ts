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

// Generation counter that invalidates in-flight poll continuations. Every
// start() and stop() bumps it. scheduleNext() captures the current generation
// when it arms a timer; after the awaited check completes, the continuation
// only reschedules if its captured generation still matches `runGen`. This
// prevents a stale continuation from a previous start/stop cycle (e.g. a
// background → foreground stop()/start() that races an in-flight
// performCheck()) from spawning a SECOND parallel poll loop.
let runGen = 0;

// Count of consecutive checks where the online state did NOT change. Drives the
// adaptive back-off; reset to 0 on any detected change so reactions stay fast.
let stableCount = 0;

// ─── Connectivity Check ──────────────────────────────────────────────────────

async function checkConnectivity(): Promise<boolean> {
  try {
    const controller = new AbortController();
    // Named `abortTimer` (not `timeoutId`) so it can never shadow/clobber the
    // module-level poll-loop handle `timeoutId` declared above.
    const abortTimer = setTimeout(() => controller.abort(), PING_TIMEOUT);
    const response = await fetch(PING_URL, {
      method: 'HEAD',
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(abortTimer);
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

  // Self-rescheduling loop. Captures the current generation when arming the
  // timer; after the awaited check it reschedules only if (a) the loop is still
  // live (timeoutId not cleared by stop()) AND (b) the generation is unchanged
  // (no start()/stop() ran during the in-flight check). Either condition failing
  // means this continuation belongs to a superseded cycle and must die quietly.
  const scheduleNext = (): void => {
    const gen = runGen;
    timeoutId = setTimeout(async () => {
      await performCheck();
      // stop()/start() may have run during the in-flight check. Only this
      // generation's live loop is allowed to continue.
      if (gen === runGen && timeoutId !== null) {
        scheduleNext();
      }
    }, nextInterval());
  };

  return {
    isOnline: true,
    lastChecked: null,

    start: () => {
      // Bump the generation so any in-flight continuation from a previous
      // start/stop cycle is invalidated (it will see gen !== runGen and die).
      runGen += 1;

      // Idempotent: if a loop is already live, tear down its timer before
      // arming a fresh one. Combined with the runGen bump above this guarantees
      // we never leave two parallel loops running.
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }

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
      // Bump the generation so an in-flight continuation that resumes after
      // this stop() sees gen !== runGen and does NOT reschedule.
      runGen += 1;
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
