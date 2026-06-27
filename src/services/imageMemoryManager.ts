// imageMemoryManager
// ------------------
// Survive memory pressure on weak devices when the user scrolls through a LOT
// of heavy images/GIFs (image-rich chats, comment threads, profiles with
// thousands of photos).
//
// THE PROBLEM
// expo-image keeps an in-memory cache of DECODED bitmaps so re-showing an image
// is instant (no re-decode). That cache is bounded by the OS, but on a weak
// device a marathon scroll session through thousands of distinct photos can
// still grow native memory faster than the OS reclaims it — and Android/iOS
// respond by OOM-killing the whole app. That's the "приложение умирает при
// высоких нагрузках" the user is worried about.
//
// THE FIX (documented, framework-native — no extra dependency)
// React Native's `AppState` emits a `memoryWarning` event that maps to the
// platform low-memory callbacks:
//   • iOS    → UIApplicationDidReceiveMemoryWarningNotification
//   • Android→ onTrimMemory(TRIM_MEMORY_RUNNING_LOW / _CRITICAL)
// When that fires we drop ONLY expo-image's in-memory bitmap cache via
// `Image.clearMemoryCache()`. The DISK cache (the downloaded WebP bytes) is
// kept, so every image the user scrolls back to re-decodes from local disk in
// a few ms — a brief, cache-fast repaint instead of a crash. This is the exact
// trade the platform wants: shed reclaimable memory the instant the OS asks,
// so our process is NOT the one chosen for termination.
//
// We also shed the memory cache when the app is BACKGROUNDED for a while: a
// backgrounded app holding a big bitmap cache is the prime OOM-kill candidate,
// and the user can't see any image anyway, so there's zero UX cost to freeing
// it. We wait a few seconds so a quick app-switch-and-return doesn't pay a
// re-decode.
//
// PROACTIVE CEILING (NEW)
// Reacting to OS warnings is necessary but not sufficient: a marathon
// media-heavy session can grow the decoded-bitmap cache faster than warnings
// arrive, and the heat/jetsam damage is already done by the time iOS/Android
// asks us to trim. So we ALSO put an explicit ceiling on the in-memory cache.
//   • If this expo-image version exposes a programmatic memory-cache-limit API
//     (feature-detected at runtime — the method name has varied across SDKs),
//     we set a single generous cap (96 MB). expo-image then evicts least-
//     recently-used bitmaps itself; an evicted image simply re-decodes from the
//     on-disk cache when next shown (no network reload). This is the ideal:
//     bounded memory with zero reload thrash for the working set.
//   • If NO such API exists (e.g. expo-image 3.x only ships clear*Cache), we
//     fall back to a periodic SUSTAINED-SESSION trim while foregrounded: once
//     every couple of minutes of continuous use we shed the bitmap cache. The
//     interval is deliberately long so the actively-scrolled working set stays
//     warm and the only cost is an occasional fast re-decode from disk — never
//     a network reload. Combined with the existing low-memory + background
//     sheds, this keeps a long session bounded so the device doesn't heat up.
//
// Everything here is best-effort and fully guarded — a failure to clear the
// cache or to apply the cap must never take the app down, and must never break
// image loading. Disk cache, downloads, and the proxy are all untouched.

import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';
import { Image } from 'expo-image';

// Coalesce bursts: the OS can fire `memoryWarning` several times in quick
// succession (one per trim level). Clearing more than once per window is
// wasted work and could thrash the cache the user is actively scrolling.
const CLEAR_THROTTLE_MS = 4000;
// How long the app must stay backgrounded before we proactively shed the
// bitmap cache. Short enough to free memory before the OS gets aggressive,
// long enough that a quick tab-out-tab-in keeps images warm.
const BACKGROUND_CLEAR_DELAY_MS = 8000;

// Explicit in-memory bitmap-cache ceiling. Generous on purpose: big enough to
// hold a healthy working set (so the visible scroll region never re-decodes),
// small enough to keep native memory bounded on weaker devices so we don't heat
// up or get jetsam-killed. ~96 MB of decoded bitmaps is a conservative cap that
// comfortably covers a screenful-plus of photos/GIFs while leaving headroom.
const MEMORY_CACHE_LIMIT_BYTES = 96 * 1024 * 1024;

// Fallback only (used when no programmatic cap API is available): how often,
// during a sustained FOREGROUND session, we shed the bitmap cache to keep a
// marathon media session bounded. Deliberately long so the actively-scrolled
// working set stays warm — the only cost on a trim is a fast re-decode of
// off-screen images from the on-disk cache, never a network reload.
const SUSTAINED_TRIM_INTERVAL_MS = 120000;

let installed = false;
let lastClearAt = 0;
let backgroundTimer: ReturnType<typeof setTimeout> | null = null;
let sustainedTrimTimer: ReturnType<typeof setInterval> | null = null;

function clearImageMemory(reason: string): void {
  const now = Date.now();
  if (now - lastClearAt < CLEAR_THROTTLE_MS) return;
  lastClearAt = now;
  try {
    // Static, async; only the in-MEMORY decoded-bitmap cache. Disk bytes stay,
    // so visible images repaint from disk fast. Swallow rejection — a failed
    // clear must never surface as an unhandled promise / crash.
    const p = Image.clearMemoryCache();
    if (p && typeof (p as any).catch === 'function') (p as any).catch(() => {});
  } catch {
    // expo-image native module unavailable on this build — no-op.
  }
  // `reason` is intentionally unused at runtime (kept for call-site clarity /
  // future perf-monitor wiring). Referenced here to satisfy noUnusedParameters
  // without changing behavior.
  void reason;
}

function clearBackgroundTimer(): void {
  if (backgroundTimer != null) {
    clearTimeout(backgroundTimer);
    backgroundTimer = null;
  }
}

function clearSustainedTrimTimer(): void {
  if (sustainedTrimTimer != null) {
    clearInterval(sustainedTrimTimer);
    sustainedTrimTimer = null;
  }
}

function startSustainedTrimTimer(): void {
  // Idempotent — never stack intervals across foreground transitions.
  clearSustainedTrimTimer();
  try {
    sustainedTrimTimer = setInterval(() => clearImageMemory('sustained'), SUSTAINED_TRIM_INTERVAL_MS);
    // Don't let this keep a (hypothetical) event loop alive; harmless no-op on
    // RN where `unref` is absent.
    (sustainedTrimTimer as unknown as { unref?: () => void })?.unref?.();
  } catch {
    sustainedTrimTimer = null;
  }
}

/**
 * Best-effort attempt to set an explicit in-memory bitmap-cache ceiling so a
 * long media-heavy session can't grow expo-image's decoded-bitmap cache
 * unbounded. The exact method name has differed across expo-image / SDK
 * versions, so we feature-detect a few known spellings at runtime instead of
 * importing a (possibly non-existent) symbol — keeping the build safe.
 *
 * Returns `true` if a cap API was found AND invoked without throwing, so the
 * caller can decide whether the periodic-trim fallback is still needed.
 * Never throws; a missing/odd API simply yields `false` (graceful no-op).
 */
function tryApplyMemoryCacheLimit(): boolean {
  try {
    // `Image` is the expo-image class; cap APIs (if any) live as static methods.
    const img = Image as unknown as Record<string, unknown>;
    // Known / plausible spellings across versions. First one that's a function
    // wins. Each is invoked with the byte ceiling.
    const candidates = [
      'setMemoryCacheLimit',
      'setMaxMemoryCacheSize',
      'setMemoryCacheSizeLimit',
      'setMemoryCacheCapacity',
    ];
    for (const name of candidates) {
      const fn = img[name];
      if (typeof fn === 'function') {
        const result = (fn as (bytes: number) => unknown).call(Image, MEMORY_CACHE_LIMIT_BYTES);
        // Some variants may return a promise — swallow any async rejection so a
        // failed cap never surfaces as an unhandled rejection / crash.
        if (result && typeof (result as { catch?: unknown }).catch === 'function') {
          (result as Promise<unknown>).catch(() => {});
        }
        return true;
      }
    }
  } catch {
    // Native module unavailable or API misbehaved — fall through to `false`.
  }
  return false;
}

/**
 * Install the global image-memory pressure handlers ONCE at app start. Returns
 * a disposer (kept for symmetry / tests; the app root mounts this for the whole
 * session and never tears it down). Idempotent — a second call is a no-op.
 */
export function installImageMemoryManager(): () => void {
  if (installed) return () => {};
  installed = true;

  const subs: NativeEventSubscription[] = [];

  // 0) Proactive CEILING. Try to set an explicit in-memory bitmap-cache cap so
  //    the decoded-bitmap cache can't grow unbounded during a long media-heavy
  //    session. If the API exists, expo-image handles LRU eviction itself and
  //    we don't need the periodic-trim fallback. Fully feature-detected.
  const capApplied = tryApplyMemoryCacheLimit();

  // 1) Real OS low-memory signal — the precise OOM-prevention hook.
  try {
    subs.push(AppState.addEventListener('memoryWarning', () => clearImageMemory('memoryWarning')));
  } catch {
    // Older/edge RN where the event type isn't supported — ignore.
  }

  // 2) Proactive shed while backgrounded (after a grace delay so a quick
    //    app-switch-and-return keeps the visible images warm). When foregrounded
    //    again, (re)arm the sustained-session trim fallback if it's in use.
  try {
    subs.push(
      AppState.addEventListener('change', (next: AppStateStatus) => {
        if (next === 'background') {
          clearBackgroundTimer();
          backgroundTimer = setTimeout(() => clearImageMemory('background'), BACKGROUND_CLEAR_DELAY_MS);
          // No point trimming on a timer while backgrounded — the background
          // shed above covers it, and the OS may freeze our timers anyway.
          if (!capApplied) clearSustainedTrimTimer();
        } else {
          // Returned to foreground (or inactive) before the timer fired — keep
          // the cache so the user's current screen doesn't re-decode.
          clearBackgroundTimer();
          // Resume the sustained-session trim for the active foreground session.
          if (!capApplied && next === 'active') startSustainedTrimTimer();
        }
      }),
    );
  } catch {
    // ignore
  }

  // 3) FALLBACK (only when no programmatic cap API was available): periodically
  //    shed the bitmap cache during a sustained foreground session so a marathon
  //    scroll can't grow native memory without bound. Long interval => the
  //    working set stays warm; a trim only costs a fast re-decode from disk.
  if (!capApplied) startSustainedTrimTimer();

  return () => {
    clearBackgroundTimer();
    clearSustainedTrimTimer();
    for (const s of subs) { try { s.remove(); } catch {} }
    installed = false;
  };
}
