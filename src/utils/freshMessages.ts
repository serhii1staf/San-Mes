/**
 * Messages that arrived while their chat was open, sent from here or received, so their bubble can
 * animate in instead of appearing in a single frame.
 *
 * Reported: sent and received messages (text, stickers, GIFs) "land abruptly". The chat screen marks
 * the id when a NEWER message becomes the newest one; the bubble asks once, when its cell starts
 * showing that message. Kept outside React because the chat list recycles its cells: a cell can be
 * handed a fresh message whatever it showed before.
 *
 * Time-limited rather than consumed: a render can run twice before it commits (and React's strict mode
 * runs initialisers twice), and a consuming read would then lose the mark. The bubble remembers per
 * cell assignment that it has animated, so a re-render does not animate it again.
 */
const FRESH_FOR_MS = 1500;
const fresh = new Map<string, number>();

export function markFreshMessage(id: string): void {
  const now = Date.now();
  // A handful of entries at most; drop the stale ones so the map cannot grow over a long session.
  for (const [key, until] of fresh) if (until < now) fresh.delete(key);
  fresh.set(id, now + FRESH_FOR_MS);
}

export function isFreshMessage(id: string): boolean {
  const until = fresh.get(id);
  return until !== undefined && until >= Date.now();
}
