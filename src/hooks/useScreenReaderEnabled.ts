import { useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';

// Whether a screen reader (VoiceOver, TalkBack) is running, shared by every consumer: one native
// query at first use and one listener for the session, the same shape as Reduce Transparency in
// SanGlassSurface.tsx. Starts false until the query answers.
let enabled = false;
let started = false;
const listeners = new Set<() => void>();

function set(next: boolean): void {
  if (next === enabled) return;
  enabled = next;
  listeners.forEach((fn) => {
    try { fn(); } catch { /* a torn-down subscriber must not break the others */ }
  });
}

function start(): void {
  if (started) return;
  started = true;
  try {
    AccessibilityInfo.isScreenReaderEnabled().then(set).catch(() => {});
    AccessibilityInfo.addEventListener('screenReaderChanged', set);
  } catch {
    // Without the module, behave as if no screen reader is running.
  }
}

function subscribe(onChange: () => void): () => void {
  start();
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function get(): boolean {
  return enabled;
}

/** True while a screen reader is on. Re-renders the consumer when that changes. */
export function useScreenReaderEnabled(): boolean {
  return useSyncExternalStore(subscribe, get, get);
}
