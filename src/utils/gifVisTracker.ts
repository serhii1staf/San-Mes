/**
 * Visibility- and scroll-aware gate for animated images in a long list.
 *
 * WHY THIS IS A SHARED MODULE NOW
 *   The logic below existed twice: as a ~100-line closure built inline inside `useRef` in
 *   `app/comments/[id].tsx`, and as an equivalent `visTracker` in `app/chat/[id].tsx`. Both were
 *   written against the same measurements and both carry the same reasoning in their comments. The
 *   profile screens needed the identical behaviour — `ProfileReplyCard` renders the reply's own GIF
 *   with animation unconditionally, so every retained row decoded every frame for as long as the
 *   list kept it — and copying it a third time would have made three places to fix a bug in.
 *
 *   Nothing about the algorithm changed in the extraction. The constants, the `ready` gate, the
 *   cap-ranking loop and the staggered resume are the versions that were already shipping.
 *
 * WHAT IT SOLVES, IN ORDER OF HOW MUCH IT COST
 *
 *   1. An animated GIF or WebP decodes EVERY FRAME for as long as its cell exists, on the UI
 *      thread, whether or not that cell is on screen. A list that retains a screenful either side
 *      of the viewport therefore pays for three screenfuls of animation.
 *
 *   2. The resume is worse than the steady state. Flipping every visible GIF back to autoplay on
 *      one frame restarts every decode simultaneously — a snapshot caught ten giphy decodes inside
 *      an ~11 ms window. So a settle HOLDS every visible GIF and releases one per
 *      `resumeIntervalMs`, and a generation counter aborts an in-flight stagger the moment a new
 *      scroll starts.
 *
 *   3. On open there is no viewable set yet, so a naive "is it visible" test answers yes for
 *      everything and the whole list decodes at once. The `ready` flag holds every GIF on its
 *      static first frame until the first viewability callback lands, which happens within a frame
 *      of layout.
 *
 *   4. Even when settled and visible, only the first `animCap` GIFs in viewable order animate.
 *      This is the Telegram behaviour and it is what bounds the cost on a screen that is nothing
 *      but GIFs.
 *
 * SUBSCRIPTION MODEL
 *   Listeners are keyed by row id rather than held in one flat set, so a scroll start notifies only
 *   the rows whose answer actually changes. Off-screen rows keep an unchanged snapshot, do not
 *   re-render, and the scroll begins without a hitch. Pair with `useSyncExternalStore` per row.
 */

export type GifVisTracker = {
  /** Subscribe a single row. Returns an unsubscribe. Use with `useSyncExternalStore`. */
  subscribeRow: (id: string, listener: () => void) => () => void;
  /** Snapshot for one row: may this row animate right now? */
  isActive: (id: string) => boolean;
  /** Feed the viewable id set, in top-to-bottom order, from `onViewableItemsChanged`. */
  update: (next: Set<string>) => void;
  /** Drive from scroll begin/idle. `true` pauses everything immediately. */
  setScrolling: (scrolling: boolean) => void;
  /** Register whether a row carries an animated image. Only these rows are ever notified. */
  setHasGif: (id: string, has: boolean) => void;
  /**
   * Cancel a pending staggered resume and drop all holds.
   *
   * The inline versions this was extracted from had no equivalent: `resumeTimer` was a
   * `setTimeout` chain owned by a closure inside `useRef`, so unmounting mid-stagger left the chain
   * running and calling `notify` into listeners of a dead screen. Harmless in practice because the
   * listener sets are emptied on unmount, but it kept a timer alive for up to
   * `animCap × resumeIntervalMs` after the screen was gone. Call this from an unmount effect.
   */
  dispose: () => void;
};

export type GifVisTrackerOptions = {
  /**
   * How many visible GIFs may animate at once. Default 2 — the value both shipping call sites
   * settled on, chosen because the on-open storm is the dominant cost and two concurrent decodes is
   * where it stops being visible.
   */
  animCap?: number;
  /** Spacing between staggered releases after a scroll settles. Default 90 ms. */
  resumeIntervalMs?: number;
};

export function createGifVisTracker(options: GifVisTrackerOptions = {}): GifVisTracker {
  const animCap = options.animCap ?? 2;
  const resumeIntervalMs = options.resumeIntervalMs ?? 90;

  let visibleSet = new Set<string>();
  let ready = false;
  let scrolling = false;
  const gifIds = new Set<string>();
  const rowListeners = new Map<string, Set<() => void>>();

  const notify = (id: string) => {
    const s = rowListeners.get(id);
    if (s) s.forEach((fn) => fn());
  };
  const notifyGifs = () => {
    gifIds.forEach((id) => notify(id));
  };

  const held = new Set<string>();
  let resumeGen = 0;
  let resumeTimer: ReturnType<typeof setTimeout> | null = null;
  const clearResume = () => {
    if (resumeTimer) {
      clearTimeout(resumeTimer);
      resumeTimer = null;
    }
  };

  return {
    subscribeRow(id, listener) {
      let s = rowListeners.get(id);
      if (!s) {
        s = new Set();
        rowListeners.set(id, s);
      }
      s.add(listener);
      return () => {
        const set = rowListeners.get(id);
        if (set) {
          set.delete(listener);
          if (set.size === 0) rowListeners.delete(id);
        }
      };
    },

    isActive(id) {
      // Nothing animates before the first viewability callback. The cap cannot rank an empty
      // viewable set, so without this every GIF reads active on open and they all decode at once.
      if (!ready) return false;
      if (!visibleSet.has(id)) return false;
      // Paused for the whole active scroll, then held until this row's staggered-resume turn.
      if (scrolling || held.has(id)) return false;
      // `visibleSet` preserves viewable order, so counting GIF rows until we reach this one gives
      // its rank among visible GIFs. Only the first `animCap` animate.
      let rank = 0;
      for (const vid of visibleSet) {
        if (!gifIds.has(vid)) continue;
        if (vid === id) return rank < animCap;
        rank++;
        if (rank >= animCap) break;
      }
      if (rank >= animCap) return false;
      return true;
    },

    update(next) {
      // Cheap identity check first: viewability fires often and an unchanged set must not cause a
      // fan-out of re-renders.
      if (ready && next.size === visibleSet.size) {
        let same = true;
        for (const id of next) {
          if (!visibleSet.has(id)) {
            same = false;
            break;
          }
        }
        if (same) return;
      }
      visibleSet = next;
      ready = true;
      notifyGifs();
    },

    setScrolling(b) {
      if (b === scrolling) return;
      scrolling = b;
      if (gifIds.size === 0) {
        clearResume();
        held.clear();
        return;
      }
      if (b) {
        // Scroll started. The `scrolling` flag alone pauses everything; notify only the VISIBLE GIF
        // rows so just those re-render to their static frame. Off-screen rows keep an unchanged
        // snapshot, so the scroll starts without a render burst.
        clearResume();
        held.clear();
        gifIds.forEach((gid) => {
          if (!ready || visibleSet.has(gid)) notify(gid);
        });
      } else {
        // Scroll settled. Hold every visible GIF, then release one per interval. No notify on hold:
        // the snapshot is already false from the scroll, so nothing re-renders until its release.
        clearResume();
        const pending = [...gifIds].filter((gid) => !ready || visibleSet.has(gid));
        pending.forEach((gid) => held.add(gid));
        const gen = ++resumeGen;
        const step = () => {
          if (gen !== resumeGen) return; // a new scroll superseded this stagger
          const nextId = pending.shift();
          if (nextId === undefined) {
            resumeTimer = null;
            return;
          }
          held.delete(nextId);
          notify(nextId);
          resumeTimer = setTimeout(step, resumeIntervalMs);
        };
        step();
      }
    },

    setHasGif(id, has) {
      if (has) gifIds.add(id);
      else {
        gifIds.delete(id);
        held.delete(id);
      }
    },

    dispose() {
      resumeGen++; // abort any in-flight stagger
      clearResume();
      held.clear();
    },
  };
}
