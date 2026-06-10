import { useCallback, useEffect, useRef } from 'react';

/**
 * Returns a stable callback that, when invoked repeatedly, runs `fn` on the
 * LEADING edge and then ignores further calls within `delayMs`. Useful for
 * gesture handlers (long-press, taps) where only the first event in a burst
 * should take effect.
 *
 * The returned function identity is stable across renders; the latest `fn` is
 * always used via a ref so callers don't need to memoize `fn`.
 */
export function useDebouncedCallback<A extends any[]>(
  fn: (...args: A) => void,
  delayMs: number
): (...args: A) => void {
  const fnRef = useRef(fn);
  const lockUntil = useRef(0);

  useEffect(() => {
    fnRef.current = fn;
  }, [fn]);

  return useCallback((...args: A) => {
    const now = Date.now();
    if (now < lockUntil.current) return;
    lockUntil.current = now + delayMs;
    fnRef.current(...args);
  }, [delayMs]);
}
