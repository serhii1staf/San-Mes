/**
 * Where a profile's scroll came to rest: updated when a drag or a fling ends, never per frame.
 *
 * The header's link drops and stickers and the compose row's emoji ticker animate for as long as they
 * run, and each of their frames costs the UI thread whether or not they are on screen (measured on the
 * Android emulator: a profile left idle kept drawing 125-185 frames a second with them running, 2-3
 * without). They pause once scrolled away. The scroll position itself is a native-driver value that JS
 * never sees, so the resting offset is kept in this tiny store, and each consumer subscribes to one
 * boolean (`useRestFlag`): a scroll end re-renders only what crosses its own limit.
 */
import { useSyncExternalStore } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

export interface ScrollRest {
  get(): number;
  subscribe(onChange: () => void): () => void;
}

/** The store, and the handler for the ScrollView's `onScrollEndDrag` and `onMomentumScrollEnd`. */
export function createScrollRest(): { rest: ScrollRest; onRest: (e: NativeSyntheticEvent<NativeScrollEvent>) => void } {
  let y = 0;
  const subscribers = new Set<() => void>();
  const onRest = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = e.nativeEvent.contentOffset.y;
    if (Math.abs(next - y) < 1) return;
    y = next;
    subscribers.forEach((cb) => cb());
  };
  const rest: ScrollRest = {
    get: () => y,
    subscribe: (cb) => {
      subscribers.add(cb);
      return () => {
        subscribers.delete(cb);
      };
    },
  };
  return { rest, onRest };
}

const noSubscription = () => () => {};

/** `test(resting offset)`, re-rendering only when its result changes. False without a store. */
export function useRestFlag(rest: ScrollRest | undefined, test: (y: number) => boolean): boolean {
  return useSyncExternalStore(rest ? rest.subscribe : noSubscription, () => (rest ? test(rest.get()) : false));
}
