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
//  1. Our OWN backend health endpoint is always asked before declaring offline. If
//     the app's API is reachable, the app is online by definition — that is the only
//     question that actually matters here. No third party gets a veto over it.
//  2. The neutral hosts are an ANY-OF race across independent networks, not a single
//     point of failure. The first success wins, so the common case costs one round
//     trip.
//
// ── WHY OUR OWN BACKEND IS NOW THE LAST PROBE, NOT THE FIRST ─────────────────
//
// It used to be raced alongside the other two on every check. A check runs on launch,
// on every return to the foreground and then every 30-120 s, so that was the single
// largest source of Worker requests in the app: roughly 40 a session, each one counted
// against the free plan's 100k a day, and none of them doing any work.
//
// The neutral hosts answer the question just as well in the normal case, and they cost
// us nothing. Our own host is still asked, but only when BOTH of them failed, which
// keeps the property the race was built for: a third party that is blocked for this
// user can never put the app into forced-offline on its own, because our backend gets
// the final word before we declare the network dead.
const PRIMARY_PROBES = [
  // Cloudflare's trace endpoint: reachable in most networks that allow any HTTPS.
  'https://cloudflare.com/cdn-cgi/trace',
  // Apple's captive-portal probe. Reachable in China and Russia (iOS itself depends
  // on it), which is exactly why it is a better backstop than Google.
  'https://captive.apple.com/hotspot-detect.html',
];
// Appended to whichever API host is current (see apiHost.ts), so the fallback asks the
// host the app will actually use.
const FALLBACK_PATH = '/v1/health';
const PING_TIMEOUT = 3000;

// A return to the foreground re-checks at once, unless the last answer is this fresh.
const RECHECK_ON_START_MS = 15000;

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
function anyOf(urls: readonly string[]): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    let pending = urls.length;
    if (pending === 0) {
      resolve(false);
      return;
    }

    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    for (const url of urls) {
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

async function checkConnectivity(): Promise<boolean> {
  if (await anyOf(PRIMARY_PROBES)) return true;
  // Both neutral hosts failed. Before calling the network dead, ask our own backend: if it answers,
  // the app can work, whatever the third parties say.
  try {
    const { getApiHost } = await import('./apiHost');
    return await probe(getApiHost() + FALLBACK_PATH);
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
      // Already polling. This is the iOS `inactive → active` blip (Control Center, a
      // permission sheet), which never called stop(): the loop is live and its last
      // answer is current, so restarting it would only buy a redundant probe.
      if (timeoutId !== null) return;

      // Bump the generation so any in-flight continuation from a previous
      // start/stop cycle is invalidated (it will see gen !== runGen and die).
      runGen += 1;

      // Drain any leftover queue from a previous session immediately. The
      // queue can carry mutations from a session that was killed before
      // it ever transitioned offline → online (the only edge the polling
      // loop below reacts to). Without this kick the items would sit in
      // AsyncStorage until the next time the device actually goes
      // offline-and-back, which on a stable connection might never happen.
      triggerProcessQueue();

      // Check immediately, unless the last answer is only seconds old (a quick
      // app switch). `performCheck` also keeps the back-off honest: the cadence
      // only drops back to 30 s when the state actually changed, not on every
      // return to the foreground.
      const last = get().lastChecked ? Date.parse(get().lastChecked as string) : 0;
      if (!last || !Number.isFinite(last) || Date.now() - last > RECHECK_ON_START_MS) {
        void performCheck();
      }

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
