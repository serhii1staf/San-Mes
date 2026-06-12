/**
 * In-app performance monitor.
 *
 * Tracks two FPS streams (JS thread + UI/native thread) plus an event ring
 * buffer (navigation transitions, slow frames, manually recorded events).
 *
 * Design constraints:
 * - The monitor itself must NOT cause jank. We sample at 500 ms (not every
 *   frame) and write to a tiny Set<Listener> instead of any state lib that
 *   would re-render the whole app on each tick.
 * - JS FPS is measured by counting requestAnimationFrame callbacks fired
 *   during a 500 ms window. If the JS thread stalls (long task, GC, blocking
 *   bridge call) we record fewer frames in that window — exactly what we
 *   want to surface.
 * - UI FPS is fed in from the native side via Reanimated's frame callback;
 *   see PerfMonitorBubble.tsx for the worklet that pushes values here. We
 *   don't run the worklet ourselves to keep this module worklet-free
 *   (otherwise importing it from regular code would bundle worklet runtime).
 * - Listeners get raw numbers; consumers decide whether to round / colour.
 *
 * Events are kept in a fixed-size ring (cheaper than shifting an array on
 * every push). The ring fills oldest-to-newest then wraps.
 */

export type PerfEventType = 'nav' | 'slow' | 'mark' | 'error';

export interface PerfEvent {
  ts: number; // Date.now() at record time
  type: PerfEventType;
  label: string;
  /** Optional duration in ms (e.g. nav transition time). */
  durationMs?: number;
  /** Optional stack trace, populated for `error` events. */
  stack?: string;
}

export interface PerfSnapshot {
  jsFps: number;
  uiFps: number;
  jsP1Min: number; // worst JS fps seen in last 5 s (smoothed minimum)
  uiP1Min: number;
  events: PerfEvent[]; // oldest-first
}

type Listener = (snap: PerfSnapshot) => void;

const RING_CAPACITY = 64;
const HISTORY_WINDOW_MS = 5_000; // sliding minimum window

class PerfMonitor {
  // Live FPS values
  private _jsFps = 0;
  private _uiFps = 0;
  // Minimum FPS observed in the last HISTORY_WINDOW_MS — useful to spot
  // brief hitches that the live value has already smoothed away.
  private _jsHistory: { ts: number; fps: number }[] = [];
  private _uiHistory: { ts: number; fps: number }[] = [];

  // Current route name. Stored so SLOW frame markers can be tagged with the
  // screen the user is on at the time of the stutter, which makes the log
  // immediately actionable ("ui<30 on profile/[id]" vs "ui<30 somewhere").
  private _currentRoute = '(root)';

  // Ring buffer of recent events.
  private _events: (PerfEvent | undefined)[] = new Array(RING_CAPACITY);
  private _eventHead = 0; // next write index
  private _eventCount = 0;

  // RAF-based JS FPS sampler.
  private _frameCount = 0;
  private _lastSampleTs = 0;
  private _rafHandle: number | null = null;
  private _started = false;

  // Listeners notified on every snapshot publish (≈ 2 Hz).
  private _listeners = new Set<Listener>();

  /** Begin sampling. Idempotent. */
  start() {
    if (this._started) return;
    this._started = true;
    this._lastSampleTs = Date.now();
    const tick = () => {
      this._frameCount += 1;
      const now = Date.now();
      const elapsed = now - this._lastSampleTs;
      // Publish about twice per second so the bubble label can update
      // without flooding the JS bridge with re-renders.
      if (elapsed >= 500) {
        const fps = Math.round((this._frameCount * 1000) / elapsed);
        this._jsFps = fps;
        this._pushHistory(this._jsHistory, now, fps);
        this._frameCount = 0;
        this._lastSampleTs = now;
        // Mark a frame as slow if either stream dropped below 30 fps —
        // visible jank threshold. Skip the very first sample to avoid
        // false positives during startup. Tag with the current route so
        // the user can immediately see WHICH screen stuttered.
        if (this._jsHistory.length > 1 && fps < 30) {
          this._record({ ts: now, type: 'slow', label: `js<30 @ ${this._currentRoute}` });
        }
        this._notify();
      }
      this._rafHandle = requestAnimationFrame(tick) as unknown as number;
    };
    this._rafHandle = requestAnimationFrame(tick) as unknown as number;
  }

  stop() {
    if (this._rafHandle != null) {
      cancelAnimationFrame(this._rafHandle as unknown as number);
      this._rafHandle = null;
    }
    this._started = false;
  }

  /** Called from the Reanimated frame-callback worklet (via runOnJS). */
  pushUiFps(fps: number) {
    this._uiFps = fps;
    this._pushHistory(this._uiHistory, Date.now(), fps);
    if (this._uiHistory.length > 1 && fps < 30) {
      this._record({ ts: Date.now(), type: 'slow', label: `ui<30 @ ${this._currentRoute}` });
    }
  }

  /** Mark a navigation transition (route change). */
  recordNavigation(routeLabel: string, durationMs?: number) {
    this._currentRoute = routeLabel;
    this._record({ ts: Date.now(), type: 'nav', label: routeLabel, durationMs });
    this._notify();
  }

  /** Generic timing/event mark from anywhere in the app. */
  mark(label: string, durationMs?: number) {
    this._record({ ts: Date.now(), type: 'mark', label, durationMs });
    this._notify();
  }

  /**
   * Capture a crash-class event. Unlike `mark`, errors carry a stack trace
   * so the panel can offer a "copy" affordance — handy for triaging when
   * the user is offline or doesn't have access to the Sentry dashboard.
   */
  recordError(label: string, stack?: string) {
    this._record({ ts: Date.now(), type: 'error', label, stack });
    this._notify();
  }

  /** Return an immutable-ish snapshot. */
  snapshot(): PerfSnapshot {
    return {
      jsFps: this._jsFps,
      uiFps: this._uiFps,
      jsP1Min: this._minOf(this._jsHistory),
      uiP1Min: this._minOf(this._uiHistory),
      events: this._readEvents(),
    };
  }

  /** Subscribe to snapshots; returns unsubscribe fn. */
  subscribe(listener: Listener): () => void {
    this._listeners.add(listener);
    // Push current state immediately so the consumer doesn't render with
    // empty values for the first sampling interval.
    listener(this.snapshot());
    return () => {
      this._listeners.delete(listener);
    };
  }

  /** Wipe the event ring (used by the panel's "clear" button). */
  clearEvents() {
    this._events = new Array(RING_CAPACITY);
    this._eventHead = 0;
    this._eventCount = 0;
    this._notify();
  }

  // --- internals ---

  private _record(ev: PerfEvent) {
    this._events[this._eventHead] = ev;
    this._eventHead = (this._eventHead + 1) % RING_CAPACITY;
    if (this._eventCount < RING_CAPACITY) this._eventCount += 1;
  }

  private _readEvents(): PerfEvent[] {
    const out: PerfEvent[] = [];
    if (this._eventCount === 0) return out;
    // Walk backwards from head so the oldest entry comes first.
    const start = (this._eventHead - this._eventCount + RING_CAPACITY) % RING_CAPACITY;
    for (let i = 0; i < this._eventCount; i++) {
      const ev = this._events[(start + i) % RING_CAPACITY];
      if (ev) out.push(ev);
    }
    return out;
  }

  private _pushHistory(arr: { ts: number; fps: number }[], ts: number, fps: number) {
    arr.push({ ts, fps });
    // Trim entries outside the rolling window — keeps memory flat.
    const cutoff = ts - HISTORY_WINDOW_MS;
    while (arr.length && arr[0].ts < cutoff) arr.shift();
  }

  private _minOf(arr: { ts: number; fps: number }[]): number {
    if (!arr.length) return 0;
    let min = arr[0].fps;
    for (let i = 1; i < arr.length; i++) if (arr[i].fps < min) min = arr[i].fps;
    return min;
  }

  private _notify() {
    if (!this._listeners.size) return;
    const snap = this.snapshot();
    this._listeners.forEach((l) => {
      try {
        l(snap);
      } catch {
        // Listener errors should never crash the monitor.
      }
    });
  }
}

export const perfMonitor = new PerfMonitor();

/**
 * Convenience helper for navigation tracking. Call when you enter a screen:
 *
 *   const stop = startNavigationTimer('feed');
 *   // ...later when first content paints:
 *   stop();
 */
export function startNavigationTimer(label: string): () => void {
  const startedAt = Date.now();
  return () => perfMonitor.recordNavigation(label, Date.now() - startedAt);
}


/**
 * Wire global JS error handlers so we capture every crash, not just the ones
 * the dev remembered to wrap in try/catch. Safe to call multiple times — the
 * second call is a no-op.
 */
let _errorHooksInstalled = false;
export function installPerfErrorHooks() {
  if (_errorHooksInstalled) return;
  _errorHooksInstalled = true;

  // React Native's global error handler. We chain to the previous one so we
  // don't override LogBox or Sentry's hooks — we only piggy-back to record
  // the failure into our local journal.
  try {
    const ErrorUtils: any = (globalThis as any).ErrorUtils;
    if (ErrorUtils?.setGlobalHandler) {
      const previous = ErrorUtils.getGlobalHandler?.();
      ErrorUtils.setGlobalHandler((err: unknown, isFatal?: boolean) => {
        try {
          const e = err as Error;
          perfMonitor.recordError(
            (isFatal ? '[fatal] ' : '') + (e?.message || String(err)),
            e?.stack,
          );
        } catch {}
        // Re-emit to the original handler so RN's red-box / Sentry / etc.
        // still see the error.
        try {
          previous?.(err, isFatal);
        } catch {}
      });
    }
  } catch {}

  // Unhandled promise rejections (Hermes exposes this via the global host).
  try {
    const tracking: any = (globalThis as any).HermesInternal?.enablePromiseRejectionTracker;
    if (typeof tracking === 'function') {
      tracking({
        allRejections: true,
        onUnhandled: (_id: number, rejection: unknown) => {
          try {
            const e = rejection as Error;
            perfMonitor.recordError(
              `[promise] ${e?.message || String(rejection)}`,
              e?.stack,
            );
          } catch {}
        },
      });
    }
  } catch {}
}
