import { create } from 'zustand';

/**
 * In-app activity alerts — the queue behind the glass pill that replaces an OS banner while the app is
 * in the foreground.
 *
 * ── WHY A STORE AND NOT JUST STATE IN THE HOST ──────────────────────────────
 *
 * The producers are not React components. A message arrives on the realtime bridge, and `shouldPresent`
 * in pushNotifications.ts is a plain async callback the native module invokes — neither can call a
 * setState on a component it has no reference to. A store is the seam both can reach, exactly as
 * `activeThread` already is for the suppression decision.
 *
 * ── SPAM IS THE DESIGN CONSTRAINT, NOT AN EDGE CASE ─────────────────────────
 *
 * The requirement was explicitly "smooth under high load and spam". Three rules keep it that way, and
 * all three are about NOT restarting the animation:
 *
 *   1. `pending` is bounded (`MAX_PENDING`). Beyond it the OLDEST waiting alert is dropped rather than
 *      the newest — the newest is the one the user has not seen yet, and an unbounded queue during a
 *      flood would keep the pill on screen long after the burst ended.
 *   2. An arriving alert that matches the one on screen (same kind, same actor) does not enqueue at
 *      all; it bumps a repeat count on the visible one. Ten messages from one person is one pill
 *      reading "10 messages", not ten sequential animations.
 *   3. Advancing to the next alert is a CONTENT swap, decided by the host, not a remount. The store
 *      only says what should be visible.
 */

export type InAppAlertKind = 'message' | 'comment' | 'like' | 'follow';

export interface InAppAlert {
  /** Stable identity for the visible pill. Used as a React key so a swap re-runs the text fade only. */
  id: string;
  kind: InAppAlertKind;
  /** Emoji avatar of the person who caused this. The pill's first phase is this glyph in a circle. */
  emoji: string;
  /** Display name, shown in bold ahead of the action text. */
  name: string;
  /** Who it was, for coalescing. Not rendered. */
  actorId?: string;
  /** Conversation / post the alert points at, so a tap can navigate. */
  targetId?: string;
  /** How many identical alerts collapsed into this one. 1 means "just this". */
  repeat: number;
}

/** Waiting alerts beyond this are dropped oldest-first. Small on purpose: see rule 1. */
const MAX_PENDING = 3;

interface InAppAlertState {
  current: InAppAlert | null;
  pending: InAppAlert[];
  /**
   * Enqueue an alert. Coalesces into the visible one when it is the same kind from the same actor.
   * Safe to call from a native callback or a realtime handler — it never touches React directly.
   */
  push: (alert: Omit<InAppAlert, 'id' | 'repeat'>) => void;
  /** The visible alert finished (timed out, tapped, or swiped). Promotes the next pending one. */
  advance: () => void;
  /** Drop everything immediately — used when the app backgrounds, so nothing is mid-flight on return. */
  clear: () => void;
}

let seq = 0;
function nextId(): string {
  seq += 1;
  return `alert-${seq}`;
}

function sameSource(a: InAppAlert, b: Omit<InAppAlert, 'id' | 'repeat'>): boolean {
  if (a.kind !== b.kind) return false;
  // Fall back to the name when there is no id, so coalescing still works for producers that only have
  // a display name to hand. Two different people with the same name merging is a far smaller problem
  // than ten pills in a row.
  if (a.actorId && b.actorId) return a.actorId === b.actorId;
  return a.name === b.name;
}

export const useInAppAlert = create<InAppAlertState>((set, get) => ({
  current: null,
  pending: [],

  push: (alert) => {
    const { current, pending } = get();

    // Rule 2 — collapse a repeat from the same source into the visible pill.
    if (current && sameSource(current, alert)) {
      set({ current: { ...current, repeat: current.repeat + 1 } });
      return;
    }

    // Same source already waiting: bump that entry instead of adding another.
    const waitingIdx = pending.findIndex((p) => sameSource(p, alert));
    if (waitingIdx >= 0) {
      const next = pending.slice();
      next[waitingIdx] = { ...next[waitingIdx], repeat: next[waitingIdx].repeat + 1 };
      set({ pending: next });
      return;
    }

    const entry: InAppAlert = { ...alert, id: nextId(), repeat: 1 };

    if (!current) {
      set({ current: entry });
      return;
    }

    // Rule 1 — bounded, dropping the oldest waiting alert.
    const next = [...pending, entry];
    set({ pending: next.length > MAX_PENDING ? next.slice(next.length - MAX_PENDING) : next });
  },

  advance: () => {
    const { pending } = get();
    if (pending.length === 0) {
      set({ current: null });
      return;
    }
    set({ current: pending[0], pending: pending.slice(1) });
  },

  clear: () => set({ current: null, pending: [] }),
}));
