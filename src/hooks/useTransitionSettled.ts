import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { NavigationContext, NavigationRouteContext } from '@react-navigation/native';

/**
 * True once the screen's push animation has finished.
 *
 * WHY NOT `InteractionManager.runAfterInteractions`
 *
 * The native stack never registers an interaction handle for its transitions, so a callback queued
 * on open runs right after the first paint, in the middle of the slide. Every "deferred" piece of
 * work on a chat or profile open was landing on the animation it was meant to avoid, which is the
 * 10-20 fps dip seen when a screen opens.
 *
 * WHAT THIS WAITS FOR
 *
 * `@react-navigation/native-stack` emits `transitionEnd` with `{ closing: false }` from the native
 * `onAppear` event (`NativeStackView.native.js`), and expo-router's fork passes it through. That is
 * the real end of the animation on both platforms. A timer backs it up for the cases where the event
 * never comes (the first screen of a cold start, a preview pop, a listener attached late).
 *
 * Screens that are not in a stack (the tab screens) have no push animation and are settled at once.
 *
 * Settled is remembered per route, so a component that mounts later on an already-open screen (a
 * profile tab the user opens five seconds in) does not wait again.
 */
const FALLBACK_MS = 650;
const settledRoutes = new Set<string>();
const firstSeenAt = new Map<string, number>();

function remember(key: string) {
  settledRoutes.add(key);
  firstSeenAt.delete(key);
  // Route keys are one per screen open; keep the set from growing for the life of the process.
  if (settledRoutes.size > 200) {
    const oldest = settledRoutes.values().next().value;
    if (oldest !== undefined) settledRoutes.delete(oldest);
  }
}

export function useTransitionSettled(): boolean {
  const navigation = useContext(NavigationContext);
  const route = useContext(NavigationRouteContext);
  const key = route?.key;

  const [settled, setSettled] = useState(() => {
    if (!navigation || !key) return true;
    let inStack = false;
    try { inStack = navigation.getState()?.type === 'stack'; } catch {}
    if (!inStack || settledRoutes.has(key)) return true;
    const seen = firstSeenAt.get(key);
    if (seen === undefined) {
      firstSeenAt.set(key, Date.now());
      return false;
    }
    return Date.now() - seen >= FALLBACK_MS;
  });

  useEffect(() => {
    if (settled || !navigation || !key) return;
    const finish = () => {
      remember(key);
      setSettled(true);
    };
    const seen = firstSeenAt.get(key) ?? Date.now();
    const timer = setTimeout(finish, Math.max(0, FALLBACK_MS - (Date.now() - seen)));
    const unsubscribe = navigation.addListener('transitionEnd' as any, (e: any) => {
      if (e?.data?.closing) return;
      finish();
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [settled, navigation, key]);

  return settled;
}

/**
 * A stable function whose promise resolves once `settled` (from `useTransitionSettled`) is true, at
 * once if it already is.
 *
 * For work that may START during the push but must not COMMIT during it: a request sent on open
 * gains the length of the slide, and its result then waits for the end of the slide to set state,
 * instead of re-rendering the screen on one of its frames. If the screen closes before it settles
 * the promise never resolves, so nothing is set on a screen that is gone.
 */
export function useSettledGate(settled: boolean): () => Promise<void> {
  const box = useRef<{ settled: boolean; waiters: (() => void)[] }>({ settled, waiters: [] });
  useEffect(() => {
    const b = box.current;
    b.settled = settled;
    if (!settled || b.waiters.length === 0) return;
    const waiters = b.waiters;
    b.waiters = [];
    for (const resolve of waiters) resolve();
  }, [settled]);
  return useCallback(() => {
    const b = box.current;
    if (b.settled) return Promise.resolve();
    return new Promise<void>((resolve) => {
      b.waiters.push(resolve);
    });
  }, []);
}
