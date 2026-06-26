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
// Everything here is best-effort and fully guarded — a failure to clear the
// cache must never take the app down. Disk cache, downloads, and the proxy are
// all untouched.

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

let installed = false;
let lastClearAt = 0;
let backgroundTimer: ReturnType<typeof setTimeout> | null = null;

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

/**
 * Install the global image-memory pressure handlers ONCE at app start. Returns
 * a disposer (kept for symmetry / tests; the app root mounts this for the whole
 * session and never tears it down). Idempotent — a second call is a no-op.
 */
export function installImageMemoryManager(): () => void {
  if (installed) return () => {};
  installed = true;

  const subs: NativeEventSubscription[] = [];

  // 1) Real OS low-memory signal — the precise OOM-prevention hook.
  try {
    subs.push(AppState.addEventListener('memoryWarning', () => clearImageMemory('memoryWarning')));
  } catch {
    // Older/edge RN where the event type isn't supported — ignore.
  }

  // 2) Proactive shed while backgrounded (after a grace delay so a quick
    //    app-switch-and-return keeps the visible images warm).
  try {
    subs.push(
      AppState.addEventListener('change', (next: AppStateStatus) => {
        if (next === 'background') {
          clearBackgroundTimer();
          backgroundTimer = setTimeout(() => clearImageMemory('background'), BACKGROUND_CLEAR_DELAY_MS);
        } else {
          // Returned to foreground (or inactive) before the timer fired — keep
          // the cache so the user's current screen doesn't re-decode.
          clearBackgroundTimer();
        }
      }),
    );
  } catch {
    // ignore
  }

  return () => {
    clearBackgroundTimer();
    for (const s of subs) { try { s.remove(); } catch {} }
    installed = false;
  };
}
