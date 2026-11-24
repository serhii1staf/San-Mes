/**
 * "The first real screen has been drawn", once per launch.
 *
 * The JS splash ("San, Привет, …") is drawn OVER the app while it mounts, and lifts only after this
 * fires, so nothing of the half-built app shows: a launch recorded on iPhone showed, between the
 * splash and the chat list, about 85 ms of a bare tab bar on an empty screen (the hidden `index`
 * route renders nothing and redirects after its first commit) and the tab icons appearing later still
 * (their font loaded lazily; it is preloaded now, see src/theme/fonts.ts).
 *
 * Fired by `useScreenMountMark` two frames after a screen's first commit, which every top-level
 * screen calls first thing. The splash also has a cap, so a screen that never calls it cannot keep
 * it up.
 */
let painted = false;
const listeners = new Set<() => void>();

export function markFirstScreenPainted(): void {
  if (painted) return;
  painted = true;
  for (const listener of Array.from(listeners)) {
    try {
      listener();
    } catch {}
  }
  listeners.clear();
}

export function isFirstScreenPainted(): boolean {
  return painted;
}

/** Calls `listener` once, when the first screen has been drawn (at once if it has). */
export function onFirstScreenPainted(listener: () => void): () => void {
  if (painted) {
    listener();
    return () => {};
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
