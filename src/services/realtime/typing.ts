/**
 * Typing indicators ("N is typing…") for chats and comment threads.
 *
 * ── SHAPE, AND WHY IT IS SPLIT IN TWO ───────────────────────────────────────
 *
 * Publishing and observing are deliberately separate hooks, because they have opposite
 * re-render requirements and putting them together forces the worse of the two on everybody:
 *
 *   `useTypingPublisher` holds NO state and returns STABLE callbacks. It is called from the
 *   composer on every keystroke, and a hook that re-rendered on each one would undo the
 *   isolated-composer work that both screens went out of their way to do (see `ChatField` in
 *   ChatInputBar.tsx and `CommentField` in app/comments/[id].tsx, both of which exist purely
 *   to keep a keystroke from re-rendering the screen).
 *
 *   `useTypingPeers` DOES hold state, so it belongs in a small leaf component that renders
 *   the indicator and nothing else. If the screen subscribed, every "someone started typing"
 *   would re-render the whole transcript. `TypingIndicator` is that leaf.
 *
 * ── CHANNEL NAMESPACE ───────────────────────────────────────────────────────
 *
 * `typing:chat:<conversationId>` and `typing:post:<postId>` — a namespace of its own, NOT the
 * existing `chat:*` / `post:*` channels.
 *
 * For `post:*` this is load-bearing: that namespace is subscribe-only in the Ably token
 * precisely so a device cannot fabricate a `comment.new` or `comment.delete`, and typing has
 * to be client-published because only the device knows a key was pressed. Granting publish
 * there to carry typing would hand over the ability to forge comment events too. A separate
 * namespace keeps the strong rule intact.
 *
 * Chats do already grant publish on `chat:*`, so typing could technically ride that channel —
 * but then a typing event would arrive at every `msg` subscriber and be filtered by name, and
 * the two surfaces would work differently for no reason. Same namespace for both.
 *
 * ── PRIVACY (Apple §3.3.3) ──────────────────────────────────────────────────
 *
 * This is the app's first presence-shaped feature, and `ActiveTodayAvatars` explicitly warned
 * against adding one without an explicit decision. The decision was made explicitly, and this
 * is deliberately the narrow version of it:
 *
 *   - Nothing is stored. Not on our backend, not in D1, not on disk. Events are transient
 *     Ably messages with no `history` capability granted, so they cannot even be replayed.
 *   - Scope is one conversation or one comment thread. There is no "online now" anywhere in
 *     the app, no last-seen, and no way to ask whether a user is active in general.
 *   - It is emitted only while the user is actively typing INTO that thread — an act already
 *     visible to its participants the moment they send.
 *   - No device identifier is involved. The payload carries the account's own profile fields.
 *
 * If a global presence/last-seen feature is ever wanted, it is a different feature with
 * different data and needs its own decision. Do not widen this one into it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { getRealtime } from './ably';
import { useAuthStore } from '../../store/authStore';

/** Channel for a 1:1 (or, later, group) chat's typing events. */
export function typingChatChannelName(conversationId: string): string {
  return `typing:chat:${conversationId}`;
}

/** Channel for a post's comment-thread typing events. */
export function typingPostChannelName(postId: string): string {
  return `typing:post:${postId}`;
}

/** Event names. Two, so a stop is instant rather than waiting for a TTL to lapse. */
const EV_TYPING = 'typing';
const EV_STOP = 'typing.stop';

/**
 * How often a continuously-typing user re-announces itself.
 *
 * A keystroke does NOT publish. Publishing per character would push dozens of messages per
 * sentence per user into a channel that many people may be watching — in a busy comment thread
 * that is the "lots of users at once" case turning into a message storm. One refresh every two
 * seconds is enough to keep the indicator alive and is bounded per user regardless of typing
 * speed.
 */
const PUBLISH_THROTTLE_MS = 2000;

/**
 * Silence after which the publisher announces a STOP by itself.
 *
 * Without this the only stops were on send and on unmount, so someone who typed a word and
 * then thought about it kept showing as typing for the full `TYPING_TTL_MS`. Reported as the
 * indicator being shown with a delay when nobody is typing — it was not a delay, it was the
 * TTL running down with nothing to cut it short.
 *
 * Longer than the throttle so a normal pause between words never trips it, shorter than the
 * TTL so it is the stop, and not the expiry, that clears the indicator in the common case.
 */
const IDLE_STOP_MS = 2600;

/**
 * How long an announcement keeps someone "typing" without a refresh.
 *
 * Must be comfortably longer than `PUBLISH_THROTTLE_MS` or a steady typist would flicker
 * between shown and hidden. Short enough that a user who backgrounds the app or loses
 * connection stops showing as typing quickly, since neither case sends a stop.
 */
const TYPING_TTL_MS = 5000;

/** How often expiries are swept. Only runs while somebody is actually typing. */
const SWEEP_MS = 1000;

export type TypingPeer = {
  /** Account id. Used as the identity key and to drop our own echo. */
  id: string;
  /** Display name, already resolved by the publisher. */
  name: string;
  /** The account's profile emoji, when it has one. */
  emoji?: string;
};

/**
 * Announce that the local user is typing on `channelName`.
 *
 * Returns stable callbacks, so passing them into a memoized composer does not defeat its
 * memoization. Both are safe to call when realtime is unavailable — they become no-ops.
 *
 * `notifyTyping` is throttled internally; call it on every keystroke and let it decide.
 * `notifyStopped` publishes immediately and is worth calling on send, on blur, and on unmount
 * so the peer's indicator disappears at once instead of lingering for the TTL.
 */
export function useTypingPublisher(channelName: string | null): {
  notifyTyping: () => void;
  notifyStopped: () => void;
} {
  const lastPublishRef = useRef(0);
  // Only publish a stop if we actually announced a start; otherwise opening a chat and
  // leaving without typing would emit a pointless event.
  const announcedRef = useRef(false);
  // Read from the store at publish time rather than subscribing, so an unrelated profile
  // change cannot re-render the composer that owns this hook.
  const channelRef = useRef<string | null>(channelName);
  channelRef.current = channelName;

  const publish = useCallback((event: string, payload: Record<string, unknown>) => {
    const channel = channelRef.current;
    if (!channel) return;
    try {
      const realtime = getRealtime();
      if (!realtime) return;
      void realtime.channels.get(channel).publish(event, payload);
    } catch {
      // Realtime unavailable. A missing typing indicator is not worth surfacing.
    }
  }, []);

  // Fires a stop when typing goes quiet, so the indicator clears on the peer promptly instead
  // of waiting out the TTL. Rearmed on every keystroke.
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  const notifyStopped = useCallback(() => {
    clearIdleTimer();
    if (!announcedRef.current) return;
    announcedRef.current = false;
    lastPublishRef.current = 0;
    const user = useAuthStore.getState().user;
    if (!user?.id) return;
    publish(EV_STOP, { id: user.id });
  }, [publish, clearIdleTimer]);

  const stopRef = useRef(notifyStopped);
  stopRef.current = notifyStopped;

  const notifyTyping = useCallback(() => {
    // Rearm the idle stop on EVERY keystroke, even the throttled ones. The throttle governs
    // how often we announce; it must not govern how quickly we notice silence.
    clearIdleTimer();
    idleTimerRef.current = setTimeout(() => {
      idleTimerRef.current = null;
      stopRef.current();
    }, IDLE_STOP_MS);

    const now = Date.now();
    if (now - lastPublishRef.current < PUBLISH_THROTTLE_MS) return;
    const user = useAuthStore.getState().user;
    if (!user?.id) return;
    lastPublishRef.current = now;
    announcedRef.current = true;
    publish(EV_TYPING, {
      id: user.id,
      name: user.displayName || user.username || '',
      emoji: user.emoji || undefined,
    });
  }, [publish, clearIdleTimer]);

  // Leaving the screen must clear the indicator on everybody else's device. Without this,
  // closing a chat mid-word leaves the peer looking at "typing…" until the TTL lapses. Also
  // disposes the idle timer, so a stop can never fire into an unmounted screen.
  useEffect(() => () => { stopRef.current(); }, []);

  return { notifyTyping, notifyStopped };
}

/**
 * Who else is currently typing on `channelName`, newest announcement last.
 *
 * Own events are dropped, so this never reports the local user back to itself.
 *
 * The returned array is reference-stable while the SET of typists is unchanged: a refresh from
 * an already-listed user updates its expiry in a ref and does not touch state. That is what
 * keeps a steady typist from re-rendering the indicator every two seconds.
 */
export function useTypingPeers(channelName: string | null): TypingPeer[] {
  const [peers, setPeers] = useState<TypingPeer[]>([]);
  // id -> { peer, expiresAt }. Held in a ref so expiry bookkeeping is not state churn.
  const entriesRef = useRef(new Map<string, { peer: TypingPeer; expiresAt: number }>());

  useEffect(() => {
    if (!channelName) {
      entriesRef.current.clear();
      setPeers((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    const entries = entriesRef.current;
    entries.clear();
    let sweep: ReturnType<typeof setInterval> | null = null;

    // Publish the derived list ONLY when the visible membership or ordering actually changed.
    const flush = () => {
      const next: TypingPeer[] = [];
      for (const { peer } of entries.values()) next.push(peer);
      setPeers((prev) => {
        if (prev.length === next.length && prev.every((p, i) => p.id === next[i].id && p.name === next[i].name && p.emoji === next[i].emoji)) {
          return prev;
        }
        return next;
      });
    };

    const stopSweepIfIdle = () => {
      if (entries.size === 0 && sweep) {
        clearInterval(sweep);
        sweep = null;
      }
    };

    // A permanent 1s timer on every open chat and comment thread would be a real idle cost.
    // It exists only while somebody is typing.
    const ensureSweep = () => {
      if (sweep) return;
      sweep = setInterval(() => {
        const now = Date.now();
        let removed = false;
        for (const [id, entry] of entries) {
          if (entry.expiresAt <= now) {
            entries.delete(id);
            removed = true;
          }
        }
        if (removed) flush();
        stopSweepIfIdle();
      }, SWEEP_MS);
    };

    const onTyping = (msg: { data?: any }) => {
      const p = msg?.data;
      if (!p || typeof p !== 'object') return;
      const id = typeof p.id === 'string' ? p.id : '';
      // ── SELF ID IS READ PER EVENT, NOT ONCE AT SUBSCRIBE ─────────────────────
      //
      // Reported as: "I am not typing and it still shows that I am typing."
      //
      // This used to capture `useAuthStore.getState().user?.id` when the effect ran. The
      // effect is keyed on `channelName`, which is available as soon as the screen has a
      // conversation id — which can be BEFORE the auth store has hydrated, and always before
      // it on a cold start into a chat. `selfId` was then `undefined`, the own-echo filter
      // never matched, and the device rendered its own typing announcement back to itself —
      // appearing about two seconds in, because that is when the first throttled publish
      // fires. Reading it per event means it is whatever is true at that moment.
      if (!id || id === useAuthStore.getState().user?.id) return;
      const peer: TypingPeer = {
        id,
        name: typeof p.name === 'string' ? p.name : '',
        emoji: typeof p.emoji === 'string' && p.emoji.length > 0 ? p.emoji : undefined,
      };
      entries.set(id, { peer, expiresAt: Date.now() + TYPING_TTL_MS });
      ensureSweep();
      // Always flush; `flush` compares membership and returns the previous array when nothing
      // visible moved, so a refresh from an already-listed typist costs no re-render. The
      // expiry it just extended lives in the ref, which state never needs to see.
      flush();
    };

    const onStop = (msg: { data?: any }) => {
      const id = typeof msg?.data?.id === 'string' ? msg.data.id : '';
      if (!id) return;
      if (!entries.delete(id)) return;
      flush();
      stopSweepIfIdle();
    };

    // Background means nothing can be typed here, and holding stale entries across a
    // background/foreground cycle is how a ghost "typing…" survives.
    const appSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') return;
      if (entries.size === 0) return;
      entries.clear();
      flush();
      stopSweepIfIdle();
    });

    let channel: ReturnType<NonNullable<ReturnType<typeof getRealtime>>['channels']['get']> | null = null;
    try {
      const realtime = getRealtime();
      if (realtime) {
        channel = realtime.channels.get(channelName);
        // Failures are logged rather than swallowed, for the reason recorded at the chat
        // screen's subscribe site: a silently dead subscription is indistinguishable from
        // "nobody is typing", and that ambiguity has already cost this app one long outage.
        channel.subscribe(EV_TYPING, onTyping).catch((err: unknown) => {
          if (__DEV__) console.warn(`[typing] subscribe failed on ${channelName}`, err);
        });
        channel.subscribe(EV_STOP, onStop).catch(() => {});
      }
    } catch {
      channel = null;
    }

    return () => {
      appSub.remove();
      if (sweep) clearInterval(sweep);
      entries.clear();
      if (channel) {
        try { channel.unsubscribe(EV_TYPING, onTyping); } catch {}
        try { channel.unsubscribe(EV_STOP, onStop); } catch {}
      }
    };
  }, [channelName]);

  return peers;
}
