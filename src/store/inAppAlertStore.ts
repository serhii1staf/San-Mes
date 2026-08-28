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

/** What the message actually contained, so the pill can say "sent a photo" rather than only "a message". */
export type InAppAlertMedia = 'photo' | 'gif' | 'text';

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
  /** Only meaningful for `kind: 'message'`. Absent means "not known", which reads as plain text. */
  media?: InAppAlertMedia;
}

// ── TWO PRODUCERS, ONE EVENT ─────────────────────────────────────────────────
//
// The realtime bridge and the push handler can both learn about the same message, and on iOS both do.
// Without a guard the store's own coalescing would then turn one message into a pill reading
// "2 messages", which is worse than either producer alone.
//
// The bridge is the PRIMARY producer because it is platform-independent and carries richer data
// (`senderEmoji`, `senderName`, the preview text — the push payload has none of those, only a title).
// The push handler is kept as a FALLBACK rather than deleted: the foreground OS banner is stood down in
// favour of the pill, so if realtime were down and the handler were also silent, the user would get no
// indication at all.
//
// The obvious guard — "ignore the same (kind, actor, target) twice within N seconds" — is WRONG here, and
// wrong in a way worth recording. Two genuine messages from one person in the same conversation share
// exactly that triple, so such a window would swallow the second real message and defeat rule 2, whose
// entire job is to turn it into "2 messages". The two producers also cannot be matched on a message id:
// Ably carries `message_id`, and the push `data` has only `{ type, conversation_id, sender_id }`.
//
// So the rule is precedence, not identity. The bridge is accepted unconditionally and stamps
// `lastBridgeAt`. A push-sourced alert is accepted only if the bridge has been quiet for
// `FALLBACK_AFTER_MS` — which is what "realtime is not delivering, fall back" actually means. Genuine
// repeats from the bridge are never blocked, and a duplicate arriving over push moments after the bridge
// already reported it is.
const FALLBACK_AFTER_MS = 8000;
let lastBridgeAt = 0;

/** Which producer an alert came from. `'push'` is the fallback and yields to a live bridge. */
export type InAppAlertSource = 'bridge' | 'push';

/** Waiting alerts beyond this are dropped oldest-first. Small on purpose: see rule 1. */
const MAX_PENDING = 3;

interface InAppAlertState {
  current: InAppAlert | null;
  pending: InAppAlert[];
  /**
   * Enqueue an alert. Coalesces into the visible one when it is the same kind from the same actor.
   * Safe to call from a native callback or a realtime handler — it never touches React directly.
   */
  push: (alert: Omit<InAppAlert, 'id' | 'repeat'>, source?: InAppAlertSource) => void;
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

  push: (alert, source = 'bridge') => {
    // Producer precedence — see the note on `FALLBACK_AFTER_MS`.
    if (source === 'bridge') {
      lastBridgeAt = Date.now();
    } else if (Date.now() - lastBridgeAt < FALLBACK_AFTER_MS) {
      return;
    }

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

  clear: () => {
    lastBridgeAt = 0;
    set({ current: null, pending: [] });
  },
}));
