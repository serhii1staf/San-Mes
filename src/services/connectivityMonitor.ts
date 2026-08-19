import { create } from 'zustand';

// ─── Constants ───────────────────────────────────────────────────────────────

// ── Reachability probes ──────────────────────────────────────────────────────
//
// This used to be a SINGLE probe against `https://www.google.com/generate_204`,
// and that was the most consequential availability bug in the app.
//
// `apiClient.request()` short-circuits EVERY call with `{ error: 'offline' }` when
// this monitor says we are offline — before it opens a socket. So a probe host that
// is unreachable for the user makes the entire app permanently read-only-from-cache
// even when our own backend answers fine. Google is blocked outright in mainland
// China and throttled by Russian ISPs, so users in those regions could sit in a
// forced-offline state indefinitely, which also reads as "my data keeps reloading /
// nothing ever updates".
//
// Two changes fix the whole class of problem:
//
//  1. The FIRST probe is our OWN backend health endpoint. If the app's API is
//     reachable, the app is online by definition — that is the only question that
//     actually matters here. No third party gets a veto over it.
//  2. It is an ANY-OF race across several independent hosts on different networks,
//     not a single point of failure. The first success wins and the rest are
//     abandoned, so the common case costs one round trip.
//
// Ordering matters: our own host first (authoritative and usually warm), then two
// widely-reachable neutral endpoints as a backstop for the case where our backend
// is down but the device genuinely has internet — we still want the app to behave as
// "online" then, so writes queue and retry rather than being rejected locally.
const PING_URLS = [
  // Cheap, public, no auth. Also the only probe whose success guarantees the app
  // can actually do useful work.
  'https://san-mes-api.odi44972.workers.dev/v1/health',
  // Cloudflare's own 204 endpoint: different apex from workers.dev, reachable in
  // most networks that allow any HTTPS at all.
  'https://cloudflare.com/cdn-cgi/trace',
  // Apple's captive-portal probe. Reachable in China and Russia (iOS itself depends
  // on it), which is exactly why it is a better backstop than Google.
  'https://captive.apple.com/hotspot-detect.html',
];
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

/**
 * Probe one host. Resolves `true` on ANY HTTP response (a 4xx still proves the
 * network path works), `false` on a transport error or the timeout.
 *
 * `HEAD` because we only care that bytes flow; `no-store` so a cached 204 from a
 * previous check can never report a dead network as alive.
 */
async function probe(url: string): Promise<boolean> {
  const controller = new AbortController();
  // Named `abortTimer` (not `timeoutId`) so it can never shadow/clobber the
  // module-level poll-loop handle `timeoutId` declared above.
  const abortTimer = setTimeout(() => controller.abort(), PING_TIMEOUT);
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      cache: 'no-store',
    });
    // Any status at all means the request reached a server.
    return response.status > 0;
  } catch {
    return false;
  } finally {
    clearTimeout(abortTimer);
  }
}

/**
 * Online when ANY probe answers.
 *
 * Implemented as a real race rather than a sequential walk: on a healthy network the
 * first host answers in tens of milliseconds and we return immediately, and on a dead
 * network every probe fails inside the shared `PING_TIMEOUT` instead of taking
 * N × timeout. `Promise.any` is not used because a single rejection shape would lose
 * the "first success wins" semantics on some Hermes builds; the explicit resolver is
 * unambiguous and has no dependency on aggregate-error support.
 */
async function checkConnectivity(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    let pending = PING_URLS.length;

    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    for (const url of PING_URLS) {
      void probe(url).then((ok) => {
        if (ok) {
          finish(true);
          return;
        }
        pending -= 1;
        // Only declare offline once EVERY probe has failed.
        if (pending === 0) finish(false);
      });
    }
  });
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
