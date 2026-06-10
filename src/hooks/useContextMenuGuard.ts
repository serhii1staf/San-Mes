import { useCallback, useEffect, useRef, useState } from 'react';

interface ContextMenuGuardOptions {
  /** How long after opening to ignore further open() calls (ms). */
  lockMs?: number;
  /** How long after closing to keep ignoring open() calls (ms). */
  closeLockMs?: number;
}

interface ContextMenuGuard<T> {
  /** The currently targeted item (drives the menu's `visible` prop). */
  target: T | null;
  /** Request opening the menu for `item`. No-ops while locked or already open. */
  open: (item: T) => void;
  /** Close the menu and arm a short lock so a trailing long-press can't reopen it. */
  close: () => void;
}

/**
 * Guards a context menu against the rapid/overlapping long-press storms that
 * freeze the app: a flurry of long-presses would otherwise call setState many
 * times and remount the <Modal> mid-animation, blocking the main thread.
 *
 * Behaviour:
 *  - `open(item)` is a no-op while a time lock is active OR a menu is already open.
 *  - The first accepted open sets the target inside requestAnimationFrame, so the
 *    state change lands on the next frame rather than synchronously during the
 *    gesture handler.
 *  - `close()` clears the target and arms a brief lock so the gesture's trailing
 *    events can't immediately reopen the menu.
 *  - The internal `openRef` is the source of truth for "is a menu currently up";
 *    it auto-recovers from any state desync on unmount/cleanup.
 *
 * Guarantees at most one active menu instance for any input sequence.
 */
export function useContextMenuGuard<T>(options: ContextMenuGuardOptions = {}): ContextMenuGuard<T> {
  const { lockMs = 500, closeLockMs = 400 } = options;
  const [target, setTarget] = useState<T | null>(null);
  const lockUntil = useRef(0);
  const openRef = useRef(false);
  const rafRef = useRef<number | null>(null);

  // Keep the openRef strictly in sync with the actual target state. Anything that
  // resets `target` to null (a child force-closing the menu, a re-render race)
  // also flips the guard back to "closed" so subsequent opens are accepted.
  useEffect(() => {
    if (target == null && openRef.current) openRef.current = false;
  }, [target]);

  // Cancel any pending rAF on unmount to avoid setState-after-unmount.
  useEffect(() => {
    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, []);

  const open = useCallback((item: T) => {
    const now = Date.now();
    if (now < lockUntil.current) return;     // within the debounce window
    if (openRef.current) return;             // a menu is already open
    openRef.current = true;
    lockUntil.current = now + lockMs;
    // Defer the state change one frame so it never runs synchronously inside the
    // long-press handler (which is where the main-thread stall happened).
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      setTarget((prev) => (prev ? prev : item));
    });
  }, [lockMs]);

  const close = useCallback(() => {
    openRef.current = false;
    lockUntil.current = Date.now() + closeLockMs;
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setTarget(null);
  }, [closeLockMs]);

  return { target, open, close };
}
