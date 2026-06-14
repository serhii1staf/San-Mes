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
 *
 * Plan for the diagnostic-event surface (so the panel can answer "what was
 * happening when the freeze hit?"):
 *  - Every event carries `kind` (NAV / MOUNT / INPUT / IMG / LONG / UI / MARK
 *    / ERROR / INTER) so the panel filters/groups can be cheap and exact.
 *  - Every event captures the `route` it occurred on at record time.
 *  - When a long-task fires we attach a tiny `context` snapshot (route,
 *    pending image decodes, time-since-last-nav, last 3 marks). Tap a row
 *    in the panel and you see the smoking gun.
 *  - `pendingDecodes` is a live counter the panel exposes as a gauge so
 *    the user can correlate "5 images mid-decode" with the freeze frame.
 *  - All public mark* methods early-return when the user has the monitor
 *    off, so the cost is one boolean check per call (plus zero allocations).
 */

import { useSettingsStore } from '../store/settingsStore';

export type PerfEventType = 'nav' | 'slow' | 'mark' | 'error';
/**
 * Coarse category used by the panel filter chips. Derived from `type` + the
 * call-site that recorded the event so the panel can do `kind === 'IMG'`
 * cheaply instead of pattern-matching the label.
 */
export type PerfEventKind =
  | 'NAV'
  | 'MOUNT'
  | 'INPUT'
  | 'IMG'
  | 'LONG'
  | 'UI'
  | 'MARK'
  | 'INTER'
  | 'ERROR';

/**
 * Snapshot of "what was active" right when a long task fired. Attached to the
 * long-task event itself so the user can tap the row in the panel and see the
 * smoking gun without scrolling for it.
 */
export interface PerfEventContext {
  route: string;
  pendingDecodes: number;
  /** ms since the last `recordNavigation` call. 0 if no nav has happened yet. */
  msSinceNav: number;
  recentMarks: { kind: PerfEventKind; label: string; durationMs?: number; agoMs: number }[];
}

export interface PerfEvent {
  ts: number; // Date.now() at record time
  type: PerfEventType;
  /** Coarse filter category. Always set; defaults to type uppercased for legacy entries. */
  kind: PerfEventKind;
  label: string;
  /** Optional duration in ms (e.g. nav transition time). */
  durationMs?: number;
  /** Optional stack trace, populated for `error` events. */
  stack?: string;
  /** The current route at record time. Used by the panel to group events. */
  route?: string;
  /** Optional bag of structured payload (host, screen, etc.) — present on a few kinds. */
  meta?: Record<string, unknown>;
  /** Long-task context, populated when the long-task detector fires. */
  context?: PerfEventContext;
}

export interface PerfSnapshot {
  jsFps: number;
  uiFps: number;
  jsP1Min: number; // worst JS fps seen in last 5 s (smoothed minimum)
  uiP1Min: number;
  events: PerfEvent[]; // oldest-first
  /** Live count of in-flight image decodes. */
  pendingDecodes: number;
  /** Current route as last reported via recordNavigation. */
  currentRoute: string;
  /** Duration of the most recent long-task event, in ms (0 if none yet). */
  lastLongTaskMs: number;
  /** Date.now() at the moment this snapshot was built. Useful for the JSON snapshot copy. */
  capturedAt: number;
}

type Listener = (snap: PerfSnapshot) => void;

const RING_CAPACITY = 64;
const HISTORY_WINDOW_MS = 5_000; // sliding minimum window
// Per-host throttle for image decode events. We don't need every single image
// log — two per host per second is plenty to spot fan-out (e.g. 8 weserv
// thumbs decoding while the user scrolls a profile).
const IMG_THROTTLE_WINDOW_MS = 1_000;
const IMG_THROTTLE_MAX_PER_WINDOW = 2;

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
  private _lastNavTs = 0;
  private _lastLongTaskMs = 0;

  // Live in-flight image-decode counter. Surfaced in the snapshot as a gauge
  // so the user can correlate "5 images mid-decode" with the freeze frame.
  private _pendingDecodes = 0;

  // Per-host log-rate throttle for `markImageDecode`. Stored as a small array
  // of timestamps per host so the cleanup is constant time.
  private _imgHostThrottle = new Map<string, number[]>();

  // Open `markInteractionStart` calls keyed by label.
  private _interactions = new Map<string, number>();

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
    let lastFrameTs = Date.now();
    const tick = () => {
      const now = Date.now();
      // Single-frame stall detection. Anything ≥120 ms between two RAF
      // callbacks means the JS thread was blocked by one big task — that's
      // far more diagnostic than a sustained <30 fps window because it
      // points at a SINGLE bad operation. Tag it with the current route so
      // the user immediately sees which screen the blocking task came
      // from. Skip the very first tick (no previous timestamp).
      if (lastFrameTs && now - lastFrameTs > 120 && now - lastFrameTs < 5000) {
        const dur = now - lastFrameTs;
        this._lastLongTaskMs = dur;
        this._record({
          ts: now,
          type: 'slow',
          kind: 'LONG',
          label: `long task @ ${this._currentRoute}`,
          durationMs: dur,
          route: this._currentRoute,
          // Smoking-gun snapshot: pending image decodes, time since last
          // navigation, and the three most recent marks. The panel shows
          // this when the user expands the long-task row.
          context: this._captureContext(),
        });
      }
      lastFrameTs = now;
      this._frameCount += 1;
      const elapsed = now - this._lastSampleTs;
      // Publish about twice per second so the bubble label can update
      // without flooding the JS bridge with re-renders.
      if (elapsed >= 500) {
        // Clamp to 120 fps — the maximum a ProMotion display can render. We
        // see RAF "catch-up" bursts after a long task ends (queued frames
        // fire back-to-back in <16 ms each), which would otherwise show as
        // 150+ fps in the bubble — confusingly suggesting better-than-
        // physical performance. The clamp keeps the displayed value bounded
        // by what the device's compositor can actually present.
        const rawFps = Math.round((this._frameCount * 1000) / elapsed);
        const fps = Math.min(120, rawFps);
        this._jsFps = fps;
        this._pushHistory(this._jsHistory, now, fps);
        this._frameCount = 0;
        this._lastSampleTs = now;
        // Sustained jank below 30 fps still gets its own marker so the user
        // can distinguish a single hitch from a long stutter.
        if (this._jsHistory.length > 1 && fps < 30) {
          this._record({
            ts: now,
            type: 'slow',
            kind: 'UI',
            label: `js<30 @ ${this._currentRoute}`,
            route: this._currentRoute,
          });
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
    // Same clamp as the JS sampler — the Reanimated frame callback can
    // also deliver catch-up bursts after a heavy native frame, and a
    // 150 fps display value is more confusing than helpful.
    const clamped = Math.min(120, Math.max(0, fps));
    this._uiFps = clamped;
    this._pushHistory(this._uiHistory, Date.now(), clamped);
    if (this._uiHistory.length > 1 && clamped < 30) {
      this._record({
        ts: Date.now(),
        type: 'slow',
        kind: 'UI',
        label: `ui<30 @ ${this._currentRoute}`,
        route: this._currentRoute,
      });
    }
  }

  /** Mark a navigation transition (route change). */
  recordNavigation(routeLabel: string, durationMs?: number) {
    this._currentRoute = routeLabel;
    this._lastNavTs = Date.now();
    this._record({
      ts: this._lastNavTs,
      type: 'nav',
      kind: 'NAV',
      label: routeLabel,
      durationMs,
      route: routeLabel,
    });
    this._notify();
  }

  /** Generic timing/event mark from anywhere in the app. */
  mark(label: string, durationMs?: number) {
    this._record({
      ts: Date.now(),
      type: 'mark',
      kind: 'MARK',
      label,
      durationMs,
      route: this._currentRoute,
    });
    this._notify();
  }

  /**
   * Uniform "screen / component just mounted" marker. Use this instead of
   * ad-hoc `mark('mount XYZ', ...)` strings — the panel groups MOUNT events
   * by route so you can see at-a-glance "12 ProfilePostCards mounted while
   * the user was on (tabs)/profile".
   *
   * Free when the monitor is off: a single boolean check + early return.
   */
  markScreenMount(screen: string, durationMs: number) {
    if (!useSettingsStore.getState().perfMonitorEnabled) return;
    this._record({
      ts: Date.now(),
      type: 'mark',
      kind: 'MOUNT',
      label: screen,
      durationMs,
      route: this._currentRoute,
    });
    this._notify();
  }

  /**
   * Keyboard-to-first-frame latency for an input field. Call from
   * `TextInput onFocus`. We record the time from the focus call until the
   * next requestAnimationFrame fires — that's the JS-thread component of
   * "tap → keyboard appears" perceived lag.
   *
   * Free when the monitor is off (no RAF scheduled, no allocation).
   */
  markInputFocus(field: string) {
    if (!useSettingsStore.getState().perfMonitorEnabled) return;
    const start = Date.now();
    requestAnimationFrame(() => {
      const ms = Date.now() - start;
      this._record({
        ts: Date.now(),
        type: 'mark',
        kind: 'INPUT',
        label: `${field} focus`,
        durationMs: ms,
        route: this._currentRoute,
      });
      this._notify();
    });
  }

  /**
   * Image bitmap decode/load completion. Call from `expo-image` `onLoad`
   * with the elapsed time from URI prop change to load.
   *
   * Throttle: the same host gets at most IMG_THROTTLE_MAX_PER_WINDOW
   * entries per IMG_THROTTLE_WINDOW_MS so a fast scroll over a feed full
   * of weserv thumbs doesn't spam the ring buffer.
   *
   * The hot call site (`CachedImage.onLoad`) does its own
   * `useSettingsStore.getState().perfMonitorEnabled` check before invoking
   * this method, so we save the function-call hop in the disabled case.
   * The check below is the safety net in case a different consumer calls in.
   */
  markImageDecode(uri: string, durationMs: number) {
    if (!useSettingsStore.getState().perfMonitorEnabled) return;
    if (!uri) return;
    let host = uri;
    try {
      host = new URL(uri).hostname.replace(/^www\./, '');
    } catch {}
    const now = Date.now();
    let seen = this._imgHostThrottle.get(host);
    if (!seen) {
      seen = [];
      this._imgHostThrottle.set(host, seen);
    }
    // Drop entries outside the throttle window in place — array stays tiny.
    while (seen.length && now - seen[0] > IMG_THROTTLE_WINDOW_MS) seen.shift();
    if (seen.length >= IMG_THROTTLE_MAX_PER_WINDOW) return;
    seen.push(now);
    this._record({
      ts: now,
      type: 'mark',
      kind: 'IMG',
      label: host,
      durationMs,
      route: this._currentRoute,
    });
    this._notify();
  }

  /**
   * Image-decode lifecycle counters. Bumped from `CachedImage` when a URI
   * starts loading and decremented on load/error/unmount. Surfaced as a
   * live gauge in the panel so the user can correlate "5 images
   * mid-decode" with a freeze frame.
   *
   * Intentionally NOT gated by perfMonitorEnabled — a single integer
   * increment is cheaper than the store lookup, and keeping the counter
   * accurate across enable/disable transitions is more useful than
   * shaving a no-op call.
   */
  incrementPendingDecodes() {
    this._pendingDecodes += 1;
  }
  decrementPendingDecodes() {
    if (this._pendingDecodes > 0) this._pendingDecodes -= 1;
  }

  /**
   * Public hook for grabbing the same long-task context snapshot the
   * built-in detector uses. Useful for consumers that want to attach
   * "what was active" payload to their own custom error event.
   */
  recordLongTaskContext(): PerfEventContext {
    return this._captureContext();
  }

  /**
   * Explicit "I am about to do X" timer pair. Use for things you can't
   * otherwise time end-to-end, e.g. tab-press-to-paint where the start is
   * an event handler and the end is in a useEffect a couple frames later.
   */
  markInteractionStart(label: string) {
    if (!useSettingsStore.getState().perfMonitorEnabled) return;
    this._interactions.set(label, Date.now());
  }
  markInteractionEnd(label: string) {
    if (!useSettingsStore.getState().perfMonitorEnabled) return;
    const start = this._interactions.get(label);
    if (start == null) return;
    this._interactions.delete(label);
    this._record({
      ts: Date.now(),
      type: 'mark',
      kind: 'INTER',
      label,
      durationMs: Date.now() - start,
      route: this._currentRoute,
    });
    this._notify();
  }

  /**
   * Capture a crash-class event. Unlike `mark`, errors carry a stack trace
   * so the panel can offer a "copy" affordance — handy for triaging when
   * the user is offline or doesn't have access to the Sentry dashboard.
   */
  recordError(label: string, stack?: string) {
    this._record({
      ts: Date.now(),
      type: 'error',
      kind: 'ERROR',
      label,
      stack,
      route: this._currentRoute,
    });
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
      pendingDecodes: this._pendingDecodes,
      currentRoute: this._currentRoute,
      lastLongTaskMs: this._lastLongTaskMs,
      capturedAt: Date.now(),
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

  /**
   * Build a tiny "what was active right now" snapshot. Attached to long-task
   * events so the user can answer the question "what kicked off the freeze".
   * Walks the ring backwards looking for up to three diagnostic marks.
   */
  private _captureContext(): PerfEventContext {
    const now = Date.now();
    const recent: PerfEventContext['recentMarks'] = [];
    if (this._eventCount > 0) {
      const start = (this._eventHead - this._eventCount + RING_CAPACITY) % RING_CAPACITY;
      // Walk newest → oldest until we've gathered three marks worth keeping.
      for (let i = this._eventCount - 1; i >= 0 && recent.length < 3; i--) {
        const ev = this._events[(start + i) % RING_CAPACITY];
        if (!ev) continue;
        if (
          ev.kind === 'MARK' ||
          ev.kind === 'MOUNT' ||
          ev.kind === 'IMG' ||
          ev.kind === 'INPUT' ||
          ev.kind === 'INTER' ||
          ev.kind === 'NAV'
        ) {
          recent.push({
            kind: ev.kind,
            label: ev.label,
            durationMs: ev.durationMs,
            agoMs: now - ev.ts,
          });
        }
      }
    }
    return {
      route: this._currentRoute,
      pendingDecodes: this._pendingDecodes,
      msSinceNav: this._lastNavTs ? now - this._lastNavTs : 0,
      recentMarks: recent,
    };
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
