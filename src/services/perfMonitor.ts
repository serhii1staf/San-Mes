/**
 * In-app performance monitor.
 *
 * Tracks two FPS streams (JS thread + UI/native thread) plus an event ring
 * buffer (navigation transitions, slow frames, manually recorded events).
 *
 * ── WHAT THIS MONITOR CANNOT SEE, MEASURED FROM OUTSIDE IT ────────────────────
 *
 * Read this before using the panel to decide what to optimise. It is here because
 * five consecutive rounds of JS-side work produced no perceptible change, and the
 * reason turned out to be that the dominant cost is invisible to every instrument
 * in this file.
 *
 * Measured on an Android emulator (1080x1920, density 480), native 1.3.0, release
 * APK, using the OS rather than this module:
 *
 *     adb shell dumpsys gfxinfo com.sanmes.app reset
 *     <8 identical swipes, 540,1400 -> 540,500 over 250 ms, 400 ms apart>
 *     adb shell dumpsys gfxinfo com.sanmes.app            # jank + percentiles
 *     adb shell dumpsys gfxinfo com.sanmes.app framestats # per-stage timestamps
 *
 * Feed scroll, 548 frames:
 *
 *     Janky frames                66 (12.04%)
 *     50th percentile             31 ms      <- the budget is 16.67 ms
 *     90th / 95th / 99th          46 / 53 / 85 ms
 *     Number Missed Vsync         11
 *     Number High input latency   960
 *     Number Slow UI thread       66         <- equals the whole jank count
 *     Number Slow bitmap uploads  0
 *     GPU, every percentile       1 ms
 *
 * The shape matters more than the magnitudes (an emulator inflates UI-thread and
 * RenderThread work). Almost no frames are DROPPED — 11 missed vsyncs out of 548 —
 * but half of them take about two frames' worth of time. That is not stutter, it is
 * a uniformly halved frame rate with late input, which is exactly the report this
 * module kept failing to explain: "it lags even though you cannot see it lag".
 * A sampler that counts frames per 500 ms window reads a steady 30 and calls it
 * healthy; the long-task detector never fires because nothing ever stalls.
 *
 * `framestats` localises it (medians over 120 complete frames):
 *
 *     input                                    0.00 ms
 *     animation (Choreographer callbacks)      1.18 ms
 *     MEASURE + LAYOUT + MOUNT                12.05 ms   <- dominant
 *     draw record                              0.12 ms
 *     sync                                     0.71 ms
 *     RenderThread (issue draw commands)       7.12 ms   <- second
 *     swap                                     1.58 ms
 *     TOTAL                                   31.67 ms
 *     late start (behind before any work)      4.37 ms
 *
 * So ~19 of the ~32 ms is UI-thread measure/layout/mount plus RenderThread
 * display-list building, for a GPU that finishes in 1 ms. None of that is the JS
 * thread, and none of it is reachable from this file.
 *
 * ── ONE HYPOTHESIS ALREADY TESTED AND REFUTED ─────────────────────────────────
 *
 * `dumpsys activity top` shows the feed's list wrapped in `ReactSwipeRefreshLayout`
 * (the `RefreshControl` whose native indicator `(tabs)/index.tsx` deliberately makes
 * invisible, because it draws its own ring next to the wordmark). An extra ViewGroup
 * in the measure path, paid for output nobody sees — an obvious suspect.
 *
 * It is not the cause. `(tabs)/profile.tsx` uses the same FlashList with NO
 * RefreshControl and therefore no `ReactSwipeRefreshLayout`; the same swipe script
 * there gives MEASURE+LAYOUT+MOUNT = 12.06 ms against the feed's 12.05 ms. The cost
 * is invariant across two structurally different screens, so it belongs to the shell
 * above the list, not to the list, the cards, or the refresh wrapper.
 *
 * For reference, that shell is 13 view levels deep before any screen content:
 * ReactSurfaceView > SafeAreaProvider > ReactViewGroup > RNGestureHandlerRootView >
 * EdgeToEdgeReactViewGroup > ScreenStack > ScreensCoordinatorLayout > Screen >
 * ScreenContentWrapper > ScreenContainer > ScreensFrameLayout > Screen >
 * ReactViewGroup, and a feed card's text sits at about level 28.
 *
 * Two things worth checking next, in this order, and both need the same before/after
 * `framestats` method rather than this panel:
 *   1. Whether the per-frame cost is being caused by something in the shell animating
 *      a LAYOUT property (height/margin/padding) every frame, which forces a full
 *      measure pass. `app/_layout.tsx` keeps several hosts permanently mounted, and
 *      `BrowserBottomBand` is documented there as a flex sibling that squeezes every
 *      screen.
 *   2. Whether this monitor itself contributes, since its rAF sampler and the
 *      `PerfMonitorBubble` worklet both run per frame. Measure with the toggle OFF
 *      before trusting any of the numbers above as the app's floor.
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

/**
 * Per-route jank aggregate. Unlike the 64-entry event ring (which wraps and
 * forgets), these counters accumulate for the whole session so the panel's
 * "Hotspots" view can rank screens by how janky they actually were — even
 * after hundreds of events have scrolled past. This is the answer to the
 * question "WHERE do the FPS drops happen?".
 */
export interface RouteHotspot {
  route: string;
  /** Number of long-task stalls (>120 ms JS-thread blocks) seen on this route. */
  longTaskCount: number;
  /** Worst single long-task duration on this route, ms. */
  worstLongMs: number;
  /** Mean long-task duration on this route, ms (0 if none). */
  avgLongMs: number;
  /** Number of sub-30-fps samples (JS or UI thread) recorded on this route. */
  jankCount: number;
  /** Worst (minimum) FPS observed on this route. 60 if never dipped. */
  worstFps: number;
  /** Number of component/screen mounts recorded on this route. */
  mountCount: number;
  /** Mean mount duration, ms (0 if none). */
  avgMountMs: number;
  /** Worst single mount duration, ms. */
  worstMountMs: number;
  /** Number of image decode events recorded on this route. */
  imgCount: number;
  /** Composite severity score used for ranking (higher = jankier). */
  score: number;
  /** Date.now() of the most recent activity on this route. */
  lastTs: number;
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
  /** Per-route jank ranking, worst-first. Drives the panel's Hotspots view. */
  hotspots: RouteHotspot[];
  /** Date.now() at the moment this snapshot was built. Useful for the JSON snapshot copy. */
  capturedAt: number;
}

/** Mutable accumulator backing one RouteHotspot. */
interface RouteStat {
  longTaskCount: number;
  worstLongMs: number;
  sumLongMs: number;
  jankCount: number;
  worstFps: number;
  mountCount: number;
  sumMountMs: number;
  worstMountMs: number;
  imgCount: number;
  lastTs: number;
}

type Listener = (snap: PerfSnapshot) => void;

const RING_CAPACITY = 64;
const HISTORY_WINDOW_MS = 5_000; // sliding minimum window
// Per-host throttle for image decode events. We don't need every single image
// log — two per host per second is plenty to spot fan-out (e.g. 8 weserv
// thumbs decoding while the user scrolls a profile).
const IMG_THROTTLE_WINDOW_MS = 1_000;
const IMG_THROTTLE_MAX_PER_WINDOW = 2;
// Sweep the per-host throttle map once it holds more distinct hosts than this.
// See `markImageDecode` for why the sweep lives here rather than inline on the
// hot path.
const IMG_HOST_SWEEP_AT = 32;

/**
 * ── SLOW EVENTS GET THEIR OWN RETENTION ─────────────────────────────────────
 *
 * The 64-entry ring holds every event: NAV, MOUNT, IMG, MARK, INPUT — and the
 * `slow` events (long tasks, sub-30fps samples) that are the only ones anybody
 * ever needs to diagnose a freeze.
 *
 * On a media-heavy route those two populations are not remotely comparable in
 * frequency. A device snapshot made the consequence explicit: `chat/[id]` had
 * accumulated 31 long tasks (worst 396 ms, average 209 ms) and 323 image marks,
 * and exactly ONE long task still had its `context` in the ring. The other
 * thirty had been overwritten by the routine marks of the very screen they were
 * recorded on — so the worst route in the app reported six and a half seconds of
 * blocked JS thread with no attribution for any of it, while every named span in
 * the buffer (`chat.reverse`, `chat.dayLabels`, `chat.persist.tail`) truthfully
 * reported 0-1 ms.
 *
 * That is a measurement defect, not a mystery: the evidence existed and the
 * buffer threw it away. Long tasks are rare by construction (a few dozen per
 * session at worst), so a small dedicated ring keeps every one of them together
 * with its smoking-gun context, no matter how much routine traffic the route
 * generates. Entries are the SAME objects as the ones in the main ring, so
 * `_readEvents` can de-duplicate by reference and nothing is double-counted.
 */
const SLOW_RING_CAPACITY = 24;

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

  // Per-route jank accumulators. Survive ring-buffer wrap so the Hotspots
  // view can rank screens over the whole session, not just the last 64
  // events. Keyed by route label.
  private _routeStats = new Map<string, RouteStat>();

  // In-flight commit batches for `noteBatchRender` / `markBatchCommit`, keyed by mark label. See the
  // note on those methods for why per-component mount timing over-reports a co-mounted batch.
  private _commitBatches = new Map<string, { start: number; count: number; scheduled: boolean }>();

  // After a long-task / stall, RAF (and the Reanimated frame callback) deliver
  // "catch-up" bursts where several queued frames fire back-to-back in <16 ms
  // each. The naive `(frameCount * 1000) / elapsed` over a 500 ms window then
  // reads as 100+ fps even on a 60 Hz device, which is more confusing than
  // helpful (especially on input-tap where the keyboard animation pauses RAF
  // briefly). The fix is hysteresis: when we detect a stall on either thread,
  // suppress the displayed FPS reading for the duration of the catch-up burst
  // (~700 ms is enough to cover even the worst observed bursts on iPhone 12).
  // Independent windows per thread so a JS-thread stall doesn't blank the
  // UI-thread reading and vice-versa.
  private _jsSuppressFpsUntil = 0;
  private _uiSuppressFpsUntil = 0;
  private static readonly _SUPPRESS_MS = 700;

  // Per-host log-rate throttle for `markImageDecode`. Stored as a small array
  // of timestamps per host so the cleanup is constant time.
  private _imgHostThrottle = new Map<string, number[]>();

  // Open `markInteractionStart` calls keyed by label.
  private _interactions = new Map<string, number>();

  // Ring buffer of recent events.
  private _events: (PerfEvent | undefined)[] = new Array(RING_CAPACITY);
  private _eventHead = 0; // next write index
  private _eventCount = 0;

  // Dedicated ring for `slow` / `error` events so a flood of routine marks can
  // never evict a long task's diagnostic context. See SLOW_RING_CAPACITY.
  private _slowEvents: (PerfEvent | undefined)[] = new Array(SLOW_RING_CAPACITY);
  private _slowHead = 0;
  private _slowCount = 0;

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
    // Largest single-frame dt observed within the current 500 ms publish
    // window. If anything in the window blew past ~50 ms (e.g. keyboard
    // focus animation pausing RAF, or a sub-long-task hitch), the window's
    // (frameCount * 1000)/elapsed reading is contaminated by the catch-up
    // burst that follows and we drop it on publish. Reset on each publish.
    let maxDtInWindow = 0;
    const tick = () => {
      // If the monitor was stopped (toggled off / app backgrounded) between
      // the last requestAnimationFrame schedule and this callback firing,
      // bail without doing any per-frame work AND without re-arming the
      // rAF chain. cancelAnimationFrame in stop() handles the common case;
      // this guard guarantees zero work even if a frame was already queued.
      if (!this._started) return;
      const now = Date.now();
      const dt = lastFrameTs ? now - lastFrameTs : 0;
      if (dt > maxDtInWindow) maxDtInWindow = dt;
      // Single-frame stall detection. Anything ≥120 ms between two RAF
      // callbacks means the JS thread was blocked by one big task — that's
      // far more diagnostic than a sustained <30 fps window because it
      // points at a SINGLE bad operation. Tag it with the current route so
      // the user immediately sees which screen the blocking task came
      // from. Skip the very first tick (no previous timestamp).
      if (lastFrameTs && now - lastFrameTs > 120 && now - lastFrameTs < 5000) {
        const dur = now - lastFrameTs;
        this._lastLongTaskMs = dur;
        // Suppress BOTH thread fps readings for the catch-up window. On
        // the JS side a stall is followed by a flurry of queued RAF
        // callbacks firing in <16 ms each, which would otherwise read
        // as 100+ fps in the bubble. On the UI side Reanimated's frame
        // callback exhibits the same catch-up pattern when the native
        // thread resumes after a heavy commit.
        this._jsSuppressFpsUntil = now + PerfMonitor._SUPPRESS_MS;
        this._uiSuppressFpsUntil = now + PerfMonitor._SUPPRESS_MS;
        const st = this._routeStat(this._currentRoute);
        st.longTaskCount += 1;
        st.sumLongMs += dur;
        if (dur > st.worstLongMs) st.worstLongMs = dur;
        st.lastTs = now;
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
        // While we're inside the post-stall suppression window, throw
        // away the sample (don't update _jsFps, don't push history) but
        // still reset the counters so the NEXT window starts fresh
        // after the catch-up burst has flushed. This keeps the bubble
        // showing the last "real" FPS instead of an inflated catch-up
        // value, which was the source of the spurious "120 fps" the
        // user saw on input tap (keyboard-focus pauses RAF briefly).
        if (now < this._jsSuppressFpsUntil) {
          this._frameCount = 0;
          this._lastSampleTs = now;
          this._rafHandle = requestAnimationFrame(tick) as unknown as number;
          return;
        }
        // Sub-threshold-pause guard: catch the case where the JS thread
        // paused 50–120 ms (e.g. a keyboard-focus animation interrupting
        // RAF) without crossing the long-task bar. Those pauses still
        // produce a catch-up burst that inflates fps. If any single frame
        // in this window had dt > 50 ms, drop the sample. This is what
        // killed the spurious "120 fps" / "150 fps" readings on input
        // tap that the user reported.
        if (maxDtInWindow > 50) {
          this._frameCount = 0;
          this._lastSampleTs = now;
          maxDtInWindow = 0;
          this._rafHandle = requestAnimationFrame(tick) as unknown as number;
          return;
        }
        const rawFps = Math.round((this._frameCount * 1000) / elapsed);
        // Cap displayed FPS at 60. iPhone non-Pro models are 60 Hz — the
        // "120 fps" the bubble previously showed on input-tap was a
        // catch-up artifact, not a real reading. Capping at 60 makes the
        // value either truthful (on 60 Hz devices) or conservative (on
        // 120 Hz ProMotion, where we under-report by half — acceptable
        // since the indicator is for spotting problems, not bragging
        // rights). Combined with the suppression and >50ms guard above,
        // the bubble now shows realistic numbers in every scenario.
        const fps = Math.min(60, rawFps);
        this._jsFps = fps;
        this._pushHistory(this._jsHistory, now, fps);
        this._bumpRouteFps(fps);
        this._frameCount = 0;
        this._lastSampleTs = now;
        maxDtInWindow = 0;
        // Sustained jank below 30 fps still gets its own marker so the user
        // can distinguish a single hitch from a long stutter.
        if (this._jsHistory.length > 1 && fps < 30) {
          this._routeStat(this._currentRoute).jankCount += 1;
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
    const now = Date.now();
    // Suppress UI-thread reading during the post-stall catch-up window —
    // the Reanimated frame callback batches frames the same way RAF does,
    // and after a JS-thread freeze (or a heavy native commit) it delivers
    // a burst that reads as 100+ fps. The bubble keeps showing the last
    // real value until the burst flushes, which is what users want.
    if (now < this._uiSuppressFpsUntil) return;
    // Same cap as the JS sampler — 60 fps reflects what 60 Hz iPhones
    // actually display; on 120 Hz ProMotion devices we under-report
    // slightly but never produce a misleading "120 fps" reading from a
    // catch-up burst.
    const clamped = Math.min(60, Math.max(0, fps));
    this._uiFps = clamped;
    this._pushHistory(this._uiHistory, now, clamped);
    this._bumpRouteFps(clamped);
    if (this._uiHistory.length > 1 && clamped < 30) {
      this._routeStat(this._currentRoute).jankCount += 1;
      this._record({
        ts: now,
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

  /**
   * Set the current route WITHOUT recording an event.
   *
   * ── WHY THIS HAD TO BE SPLIT OUT OF `recordNavigation` ────────────────────
   *
   * `_currentRoute` is the route every other mark is filed under, and it used to advance only inside
   * `recordNavigation` — which the root layout calls from inside TWO nested `requestAnimationFrame`s,
   * because the NAV *duration* is meant to approximate "time until first paint after layout".
   *
   * React flushes passive effects child-first, so a screen's own mount effect runs BEFORE the root
   * layout's `[segments]` effect, let alone two frames after it. The consequence: every
   * `markScreenMount` was stamped with the PREVIOUS route, and so were the per-route mountCount /
   * avgMountMs / worstMountMs aggregates.
   *
   * That is not a cosmetic mislabel. A snapshot showed `(tabs)/profile` with `worstMountMs: 413`, and
   * the 413 ms was the MESSAGES screen mounting — profile's own worst mount was a post-card body at
   * 77 ms. Reading that panel led straight to the wrong screen, which is the second time this file has
   * produced a confidently wrong attribution.
   *
   * So the two jobs are separate now: the route is stamped synchronously the moment the segments
   * change, and the timed NAV event still lands two frames later. Duration semantics are unchanged.
   */
  setRoute(routeLabel: string) {
    this._currentRoute = routeLabel;
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
    const st = this._routeStat(this._currentRoute);
    st.mountCount += 1;
    st.sumMountMs += durationMs;
    if (durationMs > st.worstMountMs) st.worstMountMs = durationMs;
    st.lastTs = Date.now();
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

  // ── PER-COMPONENT MOUNT TIMING OVER-REPORTS A CO-MOUNTED BATCH ──────────────
  //
  // The list-cell callers of `markScreenMount` all use the same shape: stamp `Date.now()` during
  // render, subtract it inside a `useEffect`. For ONE component that is a fair render→commit span. For
  // a batch it is not, and list cells always arrive as a batch.
  //
  // React runs every render function in the batch first, then commits, then flushes the passive
  // effects together. So with six bubbles in one commit, cell #1 stamps earliest and its effect fires
  // after ALL SIX have rendered and committed — its "mount" number contains the other five. Cell #6
  // stamps last and reports almost nothing. The numbers are overlapping suffixes of one interval, and
  // the signature is unmistakable once you look for it: six `MessageBubble.media` marks inside the same
  // millisecond reading 128, 120, 109, 69, 62, 47, and eight `ProfilePostCard.body` reading 120, 109,
  // 102, 85, 75, 63, 50, 25. Descending, co-terminating.
  //
  // The consequence is that `mountCount` counts cells rather than commits, and `sumMountMs` /
  // `avgMountMs` add up intervals that are mostly the same milliseconds counted repeatedly. Profile
  // reporting `mountCount: 88, avgMountMs: 99` does not mean 8.7 seconds of mounting. The per-batch
  // MAXIMUM was roughly honest all along; the average and the total never were, and several rounds of
  // this work were aimed using them.
  //
  // This pair measures the commit instead:
  //
  //   • `noteBatchRender` from render — keeps the EARLIEST start across the batch, counts participants.
  //   • `markBatchCommit`  from the effect — schedules ONE report, after which the accumulator resets.
  //
  // `setTimeout(0)` rather than a microtask on purpose: passive effects are flushed inside a scheduler
  // task, and a microtask queued from the first effect would run before the later effects in that same
  // flush had incremented the count. A macrotask is after the whole flush.
  //
  // The label carries the batch size (`MessageBubble.media x6`) because that is the number that tells
  // you whether to attack per-cell cost or how many cells commit together — which the old marks
  // actively obscured by looking like six separate expensive mounts.
  noteBatchRender(label: string) {
    if (!useSettingsStore.getState().perfMonitorEnabled) return;
    let b = this._commitBatches.get(label);
    if (!b) {
      b = { start: 0, count: 0, scheduled: false };
      this._commitBatches.set(label, b);
    }
    // MIN, so a re-render of an already-counted cell cannot move the start later, and so this stays
    // safe under a double-invoked render.
    if (b.start === 0) b.start = Date.now();
    b.count += 1;
  }

  markBatchCommit(label: string) {
    if (!useSettingsStore.getState().perfMonitorEnabled) return;
    const b = this._commitBatches.get(label);
    if (!b || b.start === 0 || b.scheduled) return;
    b.scheduled = true;
    setTimeout(() => {
      const durationMs = Date.now() - b.start;
      const count = b.count;
      b.start = 0;
      b.count = 0;
      b.scheduled = false;
      if (count <= 0) return;
      this.markScreenMount(count > 1 ? `${label} x${count}` : label, durationMs);
    }, 0);
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
      const u = new URL(uri);
      // Normal remote images: group by hostname. Local/inline schemes
      // (file:, data:, blob:, content:) have an empty hostname — surface
      // the scheme instead of a blank label so the panel reads
      // "file: 82ms" (a local gallery preview decoding) rather than an
      // unexplained empty row. Local full-res decodes are the usual reason
      // a chat-open frame dips, so making them legible matters.
      host = u.hostname ? u.hostname.replace(/^www\./, '') : u.protocol.replace(/:$/, '');
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
    // ── THE HYGIENE DELETE THAT USED TO BE HERE DISABLED THE THROTTLE ────────
    //
    // It read:
    //
    //   if (seen.length === 0) this._imgHostThrottle.delete(host);
    //   if (seen.length >= IMG_THROTTLE_MAX_PER_WINDOW) return;
    //   seen.push(now);
    //
    // and its comment claimed "the throttle behavior is unchanged". It was not.
    // The delete ran while `seen` was still the array this call was ABOUT to push
    // into, so the push landed in an array no longer reachable from the Map. The
    // next decode from the same host missed, allocated a fresh empty bucket, and
    // deleted the key again. The counter therefore never reached 2 and NOTHING was
    // ever throttled.
    //
    // Measured, not deduced: a snapshot recorded sixteen `pub-….r2.dev` marks
    // inside 1.01 s against a documented ceiling of two per host per second. At
    // that rate the 64-entry ring turns over in about four seconds, which is what
    // erased thirty of `chat/[id]`'s thirty-one long-task contexts.
    //
    // The delete could not have achieved its stated goal either. A bucket is only
    // ever found empty on a call for that same host — i.e. the moment before it is
    // repopulated — so a host that is seen once and never again keeps its single
    // stale timestamp regardless. Bounding the map needs a sweep across ALL hosts,
    // which is what happens below, off the per-decode path.
    if (this._imgHostThrottle.size > IMG_HOST_SWEEP_AT) {
      this._imgHostThrottle.forEach((stamps, key) => {
        if (key === host) return;
        const last = stamps.length ? stamps[stamps.length - 1] : 0;
        if (now - last > IMG_THROTTLE_WINDOW_MS) this._imgHostThrottle.delete(key);
      });
    }
    this._routeStat(this._currentRoute).imgCount += 1;
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
      hotspots: this.getHotspots(),
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
    this._slowEvents = new Array(SLOW_RING_CAPACITY);
    this._slowHead = 0;
    this._slowCount = 0;
    this._routeStats.clear();
    // Reset the image throttle buckets too. "Clear" means the panel starts from
    // nothing; leaving populated buckets behind silently suppressed the first
    // couple of decodes per host after a clear, which is the one moment the user
    // is deliberately watching for them.
    this._imgHostThrottle.clear();
    this._notify();
  }

  /**
   * Build the per-route jank ranking that drives the panel's Hotspots view.
   * Cheap: iterates the (small) route map and sorts. Higher score = jankier.
   *
   * Score weights what users actually perceive as lag:
   *  - long-task stalls hurt most (each one is a visible freeze),
   *  - sub-30fps samples next,
   *  - how deep the worst FPS dip went,
   *  - slow mounts (screen takes ages to appear).
   */
  getHotspots(): RouteHotspot[] {
    const out: RouteHotspot[] = [];
    this._routeStats.forEach((st, route) => {
      const avgLongMs = st.longTaskCount ? Math.round(st.sumLongMs / st.longTaskCount) : 0;
      const avgMountMs = st.mountCount ? Math.round(st.sumMountMs / st.mountCount) : 0;
      const fpsDip = st.worstFps < 60 ? (60 - st.worstFps) : 0;
      const score =
        st.longTaskCount * 4 +
        st.jankCount * 2 +
        st.worstLongMs / 80 +
        fpsDip / 6 +
        st.worstMountMs / 200;
      out.push({
        route,
        longTaskCount: st.longTaskCount,
        worstLongMs: st.worstLongMs,
        avgLongMs,
        jankCount: st.jankCount,
        worstFps: st.worstFps,
        mountCount: st.mountCount,
        avgMountMs,
        worstMountMs: st.worstMountMs,
        imgCount: st.imgCount,
        score: Math.round(score * 10) / 10,
        lastTs: st.lastTs,
      });
    });
    // Worst-first. Ties broken by most-recent activity so the screen the
    // user is currently abusing floats up.
    out.sort((a, b) => b.score - a.score || b.lastTs - a.lastTs);
    return out;
  }

  // --- internals ---

  /** Lazily create / fetch the accumulator for a route. */
  private _routeStat(route: string): RouteStat {
    let st = this._routeStats.get(route);
    if (!st) {
      st = {
        longTaskCount: 0,
        worstLongMs: 0,
        sumLongMs: 0,
        jankCount: 0,
        worstFps: 60,
        mountCount: 0,
        sumMountMs: 0,
        worstMountMs: 0,
        imgCount: 0,
        lastTs: Date.now(),
      };
      this._routeStats.set(route, st);
    }
    return st;
  }

  /** Track the worst (minimum) FPS seen on the current route. */
  private _bumpRouteFps(fps: number) {
    const st = this._routeStat(this._currentRoute);
    if (fps < st.worstFps) st.worstFps = fps;
    st.lastTs = Date.now();
  }

  private _record(ev: PerfEvent) {
    this._events[this._eventHead] = ev;
    this._eventHead = (this._eventHead + 1) % RING_CAPACITY;
    if (this._eventCount < RING_CAPACITY) this._eventCount += 1;
    // Mirror diagnostics into their own ring. Same object, so `_readEvents`
    // de-duplicates by reference while both copies are live.
    if (ev.type === 'slow' || ev.type === 'error') {
      this._slowEvents[this._slowHead] = ev;
      this._slowHead = (this._slowHead + 1) % SLOW_RING_CAPACITY;
      if (this._slowCount < SLOW_RING_CAPACITY) this._slowCount += 1;
    }
  }

  /** Oldest-first read of a ring buffer. */
  private _readRing(
    ring: (PerfEvent | undefined)[],
    head: number,
    count: number,
    capacity: number,
  ): PerfEvent[] {
    const out: PerfEvent[] = [];
    if (count === 0) return out;
    // Walk backwards from head so the oldest entry comes first.
    const start = (head - count + capacity) % capacity;
    for (let i = 0; i < count; i++) {
      const ev = ring[(start + i) % capacity];
      if (ev) out.push(ev);
    }
    return out;
  }

  private _readEvents(): PerfEvent[] {
    const main = this._readRing(this._events, this._eventHead, this._eventCount, RING_CAPACITY);
    if (this._slowCount === 0) return main;
    // Re-admit any long task / sub-30fps sample that the main ring has already
    // forgotten. On a quiet route every slow event is still present here and this
    // adds nothing; on a media-heavy route it is the difference between "31 long
    // tasks, one of them explained" and all of them keeping their context.
    const slow = this._readRing(this._slowEvents, this._slowHead, this._slowCount, SLOW_RING_CAPACITY);
    const present = new Set<PerfEvent>(main);
    const evicted = slow.filter((ev) => !present.has(ev));
    if (evicted.length === 0) return main;
    return main.concat(evicted).sort((a, b) => a.ts - b.ts);
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
