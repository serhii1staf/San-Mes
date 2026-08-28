import { useEffect, useRef } from 'react';
import { perfMonitor } from '../services/perfMonitor';
import { useSettingsStore } from '../store/settingsStore';

/**
 * Mark how long a screen took to get on screen, honestly.
 *
 * ── WHY THIS EXISTS: THE OLD MEASUREMENT WAS WRONG BY ~4x ─────────────────────
 *
 * Nine screens hand-rolled the same three lines:
 *
 *     const mountStart = useRef(Date.now()).current;
 *     useEffect(() => {
 *       perfMonitor.markScreenMount('<screen>', Date.now() - mountStart);
 *     }, []);
 *
 * and every copy of it sat wherever it happened to be pasted in the hook list. In
 * `app/chat/[id].tsx` that was ~180 lines in, which put these BEFORE the ref and therefore
 * outside the measurement:
 *
 *   • `useLocalSearchParams`, `useTheme`, `useSafeAreaInsets`, `useChatKeyboardMode`;
 *   • the `routeIdIsCanonical` memo, which reads the entity store;
 *   • the `seedMessages` memo — a synchronous MMKV read plus a `JSON.parse` of the message tail,
 *     which is the single most expensive thing on the open path;
 *   • every store subscription the transcript depends on.
 *
 * And because the stamp was read in the first passive effect, everything AFTER that was outside it
 * too: the ~35 remaining effects, and the commit work React does once effects have flushed.
 *
 * The gap is not academic. An on-device log recorded
 *
 *     MOUNT [chat/[id]] chat/[id] 36ms
 *
 * sitting inside a measured 150 ms long task on the same screen, in the same window. Reading 36 ms
 * and concluding the render was cheap is exactly how several rounds of work went to the wrong place.
 *
 * ── WHAT THIS MEASURES ────────────────────────────────────────────────────────
 *
 * From the FIRST hook of the component (so call it first — that is the whole point) to one frame
 * after the first passive effect. The trailing `requestAnimationFrame` is what picks up the rest of
 * the commit: an rAF scheduled from inside an effect runs on the next frame, by which point React
 * has finished flushing effects and handed its mount instructions to the host.
 *
 * Stated precisely so the number is not over-read: this is JS-side work from render start until the
 * frame after commit. It is NOT "time until pixels", which happens on the UI thread and is not
 * observable from here. It is, however, the whole of the JS cost the screen imposes on the frames
 * the user is waiting through, which is the number worth attacking.
 *
 * ── THE NUMBERS WILL JUMP, AND THAT IS THE FIX ────────────────────────────────
 *
 * Because the window is wider at both ends, every screen's `avgMountMs` / `worstMountMs` will read
 * higher than it did before. Nothing got slower. The old figures were an underestimate and are not
 * comparable to these.
 */
export function useScreenMountMark(screen: string): void {
  // Lazy, not `useRef(Date.now())`: the argument form re-evaluates `Date.now()` on every render and
  // throws the result away. This writes once, on the first render, which is also what the name says.
  const startedAtRef = useRef<number | null>(null);
  if (startedAtRef.current === null) startedAtRef.current = Date.now();

  useEffect(() => {
    // Read the flag at effect time rather than subscribing to it. Subscribing would re-run this on a
    // later toggle with a long-stale start stamp — the bug that produced fake multi-minute mount
    // durations in the panel once already.
    if (!useSettingsStore.getState().perfMonitorEnabled) return;
    const startedAt = startedAtRef.current ?? Date.now();
    const raf = requestAnimationFrame(() => {
      perfMonitor.markScreenMount(screen, Date.now() - startedAt);
    });
    // A screen unmounted inside one frame reports nothing, which is correct: it never got on screen.
    return () => cancelAnimationFrame(raf);
    // Mount-only. `screen` is a literal at every call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
