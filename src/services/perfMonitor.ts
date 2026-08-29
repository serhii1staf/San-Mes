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
  | 'ERROR'
  /**
   * A gap in the sampler loop with NO instrumented app activity inside it.
   *
   * Reported separately from `LONG` and deliberately NOT counted in
   * `RouteHotspot.longTaskCount`, because the two are not the same finding: `LONG` means the JS
   * thread was demonstrably busy, `IDLE` means the sampler simply was not serviced and the monitor
   * cannot say why. See the long note on the detector in `start()`.
   */
  | 'IDLE';

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
  /**
   * Sampler gaps this session that carried no instrumented app activity, so could not be attributed
   * to a blocked JS thread. Surfaced so a snapshot dominated by them reads as "the sampler was
   * starved" rather than as a pile of long tasks — the old detector reported these as real stalls
   * and they were the bulk of what showed up while the app sat idle.
   */
  idleGapCount: number;
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
  private _commitBatches = new Map<string, { start: number; count: number }>();

  // ── THE JS-SIDE SUPPRESSION WINDOW WAS REMOVED. READ THIS BEFORE ADDING IT BACK ──
  //
  // It used to exist on both threads, justified like this: "after a stall, RAF delivers catch-up
  // bursts where several queued frames fire back-to-back in <16 ms each, so
  // `(frameCount * 1000) / elapsed` reads as 100+ fps". Any window inside the 700 ms after a stall
  // was therefore DISCARDED.
  //
  // For the JS sampler that premise is false, and the guard did real damage. Two facts:
  //
  //   1. `requestAnimationFrame` in React Native is not a frame callback. From the installed
  //      source, `node_modules/react-native/Libraries/Core/Timers/JSTimers.js`:
  //
  //          requestAnimationFrame: function (func) {
  //            const id = _allocateCallback(func, 'requestAnimationFrame');
  //            createTimer(id, 1, Date.now(), /* recurring */ false);
  //          }
  //
  //      A one-shot 1 ms timer. Not vsync, not the Choreographer, no 60 Hz ceiling.
  //
  //   2. The sampler re-arms itself at the END of `tick`, so exactly ONE timer is outstanding at
  //      any moment. Native has nothing queued to flush, so the "several queued frames fire
  //      back-to-back" burst cannot happen here. The mechanism the guard defended against does not
  //      exist in this implementation.
  //
  // What the guard DID do: a long task every ~1.5 s (which is what the profile screen actually
  // produced) marks ~700 ms after each one as unusable. Combined with the `maxDtInWindow > 50`
  // drop, nearly every window in which the thread was struggling got thrown away, and `_jsFps`
  // kept whatever the last surviving window said — and the surviving windows are the quiet gaps.
  // That is the mechanism behind the bubble reading 56-60 while the scroll it was measuring ran at
  // 24 fps by `dumpsys gfxinfo`. A guard added to stop over-reporting was causing systematic
  // under-reporting of exactly the condition the tool exists to find.
  //
  // The UI-thread window is KEPT. `pushUiFps` is fed from a Reanimated frame-callback worklet,
  // which is a genuine vsync-driven callback on the native thread, so batching after a heavy
  // commit is plausible there. Removing it too would be changing something on a hunch, which is
  // how the JS side got wrong in the first place.
  private _uiSuppressFpsUntil = 0;
  private static readonly _SUPPRESS_MS = 700;

  /**
   * `Date.now()` of the last INSTRUMENTED APP event (mount, mark, image decode, nav, input,
   * interaction). Written by `_record`, and deliberately not by `slow`/`error` records so the
   * monitor's own bookkeeping cannot corroborate itself.
   *
   * This is what lets the detector separate "the JS thread was blocked" from "the sampler was not
   * serviced". See the note in `start()`.
   */
  private _lastActivityTs = 0;

  /**
   * Count of sampler gaps that carried no instrumented activity, per session. Exposed on the
   * snapshot so a reading full of them is visibly untrustworthy instead of quietly wrong.
   */
  private _idleGapCount = 0;

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
    // `maxDtInWindow` used to be tracked here to power the ">50 ms in this window, drop the
    // sample" guard. That guard is gone (see the note at the publish branch), and with it the only
    // reader of the variable, so it is gone too. Per-gap information is not lost: every gap over
    // 120 ms is recorded as its own `LONG` / `IDLE` event with its exact duration.
    const tick = () => {
      // If the monitor was stopped (toggled off / app backgrounded) between
      // the last requestAnimationFrame schedule and this callback firing,
      // bail without doing any per-frame work AND without re-arming the
      // rAF chain. cancelAnimationFrame in stop() handles the common case;
      // this guard guarantees zero work even if a frame was already queued.
      if (!this._started) return;
      const now = Date.now();
      // Single-frame stall detection. Anything ≥120 ms between two RAF
      // callbacks means the JS thread was blocked by one big task — that's
      // far more diagnostic than a sustained <30 fps window because it
      // points at a SINGLE bad operation. Tag it with the current route so
      // the user immediately sees which screen the blocking task came
      // from. Skip the very first tick (no previous timestamp).
      if (lastFrameTs && now - lastFrameTs > 120 && now - lastFrameTs < 5000) {
        const dur = now - lastFrameTs;
        // ── A GAP IS NOT PROOF OF A LONG TASK ───────────────────────────────
        //
        // This block used to treat every gap over 120 ms as a JS-thread block, and that produced
        // false positives I measured directly: monitor OFF, app left completely idle for 20 s,
        // `dumpsys gfxinfo` reporting 0 frames rendered and 0 missed vsyncs — and the monitor
        // still logging "long tasks". Nothing was blocked. Nothing was even drawing.
        //
        // The reason is the sampler's clock. `requestAnimationFrame` here is a one-shot 1 ms
        // native timer (see the note on `_uiSuppressFpsUntil`), and the native Timing module that
        // services it is driven off the platform's frame loop. When the app has no reason to
        // produce frames, that loop is not running at a steady 60 Hz, so the timer is serviced
        // late. A late timer and a blocked thread look IDENTICAL from inside the callback: both
        // are just a large `Date.now()` delta. The old code read every one of them as the second
        // thing.
        //
        // So the gap is corroborated against instrumented app activity. If anything the app does
        // was recorded inside the gap — a component mount, an image decode, a named mark, a
        // navigation, an input — then the thread was demonstrably doing work while the sampler
        // was starved, and "long task" is a supported claim. If the gap is empty, it is reported
        // as `IDLE` and kept out of `longTaskCount`.
        //
        // HONEST LIMITATION: work the app does without instrumenting itself — a large JSON parse,
        // a store reconciliation with no mark around it — lands in the `IDLE` bucket even though
        // the thread really was busy. That is why an idle gap is still RECORDED rather than
        // dropped: the evidence stays visible, only the confident label is withheld. The fix for
        // that class of blind spot is more marks at the call sites, not a looser detector here.
        const corroborated = this.classifyGap(lastFrameTs) === 'LONG';
        this._lastLongTaskMs = dur;
        // The UI-thread reading is still suppressed either way: whatever starved this sampler,
        // the Reanimated frame callback on the other thread is subject to the same catch-up
        // behaviour, and that window is the one whose premise still holds.
        this._uiSuppressFpsUntil = now + PerfMonitor._SUPPRESS_MS;
        if (corroborated) {
          const st = this._routeStat(this._currentRoute);
          st.longTaskCount += 1;
          st.sumLongMs += dur;
          if (dur > st.worstLongMs) st.worstLongMs = dur;
          st.lastTs = now;
        } else {
          this._idleGapCount += 1;
        }
        this._record({
          ts: now,
          type: 'slow',
          kind: corroborated ? 'LONG' : 'IDLE',
          label: corroborated
            ? `long task @ ${this._currentRoute}`
            : `idle gap @ ${this._currentRoute} (no recorded work)`,
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
        // ── NO SAMPLE IS DISCARDED ANY MORE ─────────────────────────────────
        //
        // Two guards used to live here and both dropped the window outright: one for the 700 ms
        // after a long task, one for any window containing a single frame gap over 50 ms. Their
        // shared premise was a catch-up burst of queued rAF callbacks inflating the rate. With a
        // one-shot 1 ms timer re-armed at the end of each tick there is never more than one
        // callback outstanding, so there is nothing to queue and nothing to flush — see the long
        // note on `_uiSuppressFpsUntil`.
        //
        // Their actual effect was to throw away every window in which the thread was struggling
        // and leave `_jsFps` showing the last quiet one. Removing them is what makes a bad scroll
        // read as a bad number.
        //
        // The arithmetic needs no guard to stay honest: `elapsed` is at least 500 ms of real time
        // and `_frameCount` is the number of times this callback actually ran in it, so the result
        // cannot exceed the rate the loop truly achieved. A stall pulls it DOWN, which is correct.
        const rawHz = Math.round((this._frameCount * 1000) / elapsed);
        // ── AND IT IS NOT CAPPED AT 60, BECAUSE IT IS NOT A FRAME RATE ───────
        //
        // The old cap was justified as "60 Hz is what iPhones display, so 120 must be a catch-up
        // artifact". Both halves are wrong. This loop is a 1 ms timer chain, not vsync: it has no
        // display refresh ceiling, and on an unblocked JS thread it genuinely does exceed 60
        // iterations per second. That — not ProMotion, not a burst — is where the "120 fps" came
        // from, and clamping it to 60 was hiding a units error behind a plausible-looking number.
        //
        // Kept as `jsFps` in the snapshot to avoid churning every consumer, but it is a JS
        // event-loop rate. Its VALUE is not comparable to the UI number; its DROPS are the signal.
        const fps = Math.max(0, rawHz);
        this._jsFps = fps;
        this._pushHistory(this._jsHistory, now, fps);
        this._bumpRouteFps(fps);
        this._frameCount = 0;
        this._lastSampleTs = now;
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
    // A coalesced publish must not outlive the monitor: without this, toggling
    // the monitor off inside the publish window still delivered one more full
    // snapshot up to 500 ms later.
    if (this._publishTimer != null) {
      clearTimeout(this._publishTimer);
      this._publishTimer = null;
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
  // The label carries the batch size (`MessageBubble.media x6`) because that is the number that tells
  // you whether to attack per-cell cost or how many cells commit together — which the old marks
  // actively obscured by looking like six separate expensive mounts.
  //
  // ── THE FIRST VERSION OF THIS PAIR WAS ALSO WRONG, AND MORE LOUDLY ──────────
  //
  // It noted on EVERY render and drained on a `setTimeout(0)`. The effect, though, only fires when its
  // deps change — so a plain re-render set `start` and nothing ever flushed it. The accumulator then sat
  // holding a timestamp from an arbitrarily earlier render until some later cell mounted and printed the
  // span since it. That produced `MessageBubble.media x8` at 980 ms, `x12` at 804 ms, and a
  // `(tabs)/profile worstMountMs` of 3528 ms. There is no 3.5-second commit; that number was the giveaway.
  //
  // Two changes make it sound:
  //
  //   • Callers note ONCE PER COMPONENT INSTANCE, on the render where the gate first opens, guarded by a
  //     ref. So `count` is the number of cells newly mounting and re-renders cannot touch the batch.
  //   • The drain is SYNCHRONOUS in the effect, and the accumulator is emptied there. React renders every
  //     component in a commit before running any effect, so by the time the first effect fires `count` is
  //     already complete — the `setTimeout` it was reaching for was never necessary. Later effects in the
  //     same flush find an empty accumulator and no-op, which is the correct behaviour rather than a
  //     missed contribution.
  //
  // Net effect: one mark per commit, spanning first-mount-render → first-effect, with an exact cell count.
  noteBatchRender(label: string) {
    if (!useSettingsStore.getState().perfMonitorEnabled) return;
    let b = this._commitBatches.get(label);
    if (!b) {
      b = { start: 0, count: 0 };
      this._commitBatches.set(label, b);
    }
    if (b.start === 0) b.start = Date.now();
    b.count += 1;
  }

  markBatchCommit(label: string) {
    if (!useSettingsStore.getState().perfMonitorEnabled) return;
    const b = this._commitBatches.get(label);
    // An empty accumulator means an earlier effect in this same flush already reported the batch.
    if (!b || b.start === 0) return;
    const durationMs = Date.now() - b.start;
    const count = b.count;
    b.start = 0;
    b.count = 0;
    if (count <= 0) return;
    this.markScreenMount(count > 1 ? `${label} x${count}` : label, durationMs);
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
      idleGapCount: this._idleGapCount,
      hotspots: this.getHotspots(),
      capturedAt: Date.now(),
    };
  }

  /** Subscribe to snapshots; returns unsubscribe fn. */
  subscribe(listener: Listener): () => void {
    this._listeners.add(listener);
    // Push current state immediately so the consumer doesn't render with
    // empty values for the first sampling interval. This IS a full snapshot, so
    // it counts as a publish — otherwise a subscribe immediately followed by a
    // mark built two of them back to back.
    this._lastPublishAt = Date.now();
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
    this._idleGapCount = 0;
    // Forget the corroboration timestamp too. Left behind, it is a timestamp from BEFORE the clear
    // that still sits after the sampler's `lastFrameTs`, so the first gap after a clear would be
    // vouched for by work the user just asked to be forgotten.
    this._lastActivityTs = 0;
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

  /**
   * The corroboration rule, in one place.
   *
   * `LONG` when instrumented app work was recorded after `gapStartTs`, i.e. inside the sampler gap
   * that ended now — the thread was demonstrably busy. `IDLE` when the gap is empty, which means the
   * sampler was not serviced and the monitor cannot attribute that to the app.
   *
   * Lives here rather than inline in the sampler loop for two reasons: the rule is the whole basis
   * for trusting a `LONG` count, so it should be readable without unpicking a closure; and it cannot
   * be exercised from a test while it is trapped inside `requestAnimationFrame`.
   *
   * @internal Not private so the unit test can drive it directly. Not part of the public surface.
   */
  classifyGap(gapStartTs: number): 'LONG' | 'IDLE' {
    return this._lastActivityTs > gapStartTs ? 'LONG' : 'IDLE';
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
    } else {
      // Timestamp of the last thing the APP did, which is what the long-task detector corroborates
      // a sampler gap against. `slow` and `error` are excluded above by construction: they are the
      // monitor's own output, and letting them count as activity would let one long task vouch for
      // the next one and re-introduce exactly the false positives this guards against.
      this._lastActivityTs = ev.ts;
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

  // ── THE PROFILER WAS BILLING ITSELF TO THE THING IT PROFILES ──────────────
  //
  // `_notify` used to build a FULL snapshot on every single call, before any
  // consumer had a chance to throttle. There are nine call sites and only one
  // of them is the 500 ms publish — the others are `mark`, `markScreenMount`,
  // `markInput`, `markImageDecode`, `recordNavigation` and `clearEvents`. So a
  // burst of sixteen image decodes built sixteen full snapshots.
  //
  // "Full snapshot" is not cheap. `snapshot()` calls `_readEvents()`, which
  // reads the main ring into a new array of up to RING_CAPACITY entries, reads
  // the slow ring into a second array, builds a Set over the first, filters the
  // second against it, concatenates, and SORTS the result by timestamp. Then
  // `getHotspots()` allocates a fresh 12-field object per tracked route and
  // sorts those too. Two sorts and four-plus allocations, per mark.
  //
  // Both consumers throttle at 480 ms (`PerfMonitorBubble`, `PerfMonitorPanel`)
  // against a 500 ms publish cadence, so the throttle never fired for a timer
  // publish and never protected anything from the mark-driven ones either — the
  // snapshot was already built by the time the listener decided to drop it.
  //
  // This is now coalesced AT THE SOURCE. A notify inside the minimum interval
  // does no work beyond a clock read and, at most, arming one trailing timer;
  // the snapshot is built once per interval no matter how many marks land in
  // it. The trailing publish matters: it guarantees the last mark of a burst is
  // still delivered rather than silently dropped, which a bare rate limit would
  // do.
  private _lastPublishAt = 0;
  private _publishTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly _MIN_PUBLISH_MS = 500;

  private _notify() {
    if (!this._listeners.size) return;
    const now = Date.now();
    const since = now - this._lastPublishAt;
    if (since < PerfMonitor._MIN_PUBLISH_MS) {
      // Inside the window: arm ONE trailing publish and return. No snapshot.
      if (this._publishTimer == null) {
        this._publishTimer = setTimeout(() => {
          this._publishTimer = null;
          this._publish();
        }, PerfMonitor._MIN_PUBLISH_MS - since);
      }
      return;
    }
    this._publish();
  }

  private _publish() {
    if (!this._listeners.size) return;
    if (this._publishTimer != null) {
      clearTimeout(this._publishTimer);
      this._publishTimer = null;
    }
    this._lastPublishAt = Date.now();
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
