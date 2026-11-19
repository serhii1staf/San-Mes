import { kvGetJSONSync } from '../services/kvStore';
import { mergeHistory, type MergeableItem } from './mergeHistory';

/** How many of the newest messages `chat_tail:<id>` holds. The chat screen's `SEED_CAP`. */
export const CHAT_TAIL_ROWS = 60;

/**
 * The newest `cap` messages of a conversation as this device has them on disk, oldest first.
 *
 * Reads `chat_tail:<id>` first: at most `cap` rows, which is what makes opening a chat cheap. A tail
 * SHORTER than `cap` is either a short chat or a tail that was written from a short in-memory bucket.
 * The realtime bridge used to create such a bucket from a single ping, and the chat screen then wrote
 * it over the tail, so the chat opened as that one message from then on. The full
 * `chat_messages:<id>` blob tells the two cases apart. For a short chat it is as small as the tail;
 * for an overwritten tail it still holds the history, because writes to it merge rather than replace.
 *
 * Rows come back as stored. Callers heal legacy sender ids and drop deleted rows themselves.
 */
export function readChatDiskSeed<T extends MergeableItem>(conversationId: string, cap: number): T[] {
  return readChatDiskSeedRows<T>(conversationId, cap).rows;
}

/**
 * `readChatDiskSeed`, plus how many rows `chat_tail:<id>` itself held. The chat screen rewrites the
 * tail when the seed had to be topped up from the blob, and it used to parse the tail a second time
 * just to learn its length: 10.8 ms on the emulator for a 60-row tail of long messages, right after
 * the open animation.
 */
export function readChatDiskSeedRows<T extends MergeableItem>(
  conversationId: string,
  cap: number,
): { rows: T[]; tailRows: number } {
  const stored = kvGetJSONSync<T[]>(`chat_tail:${conversationId}`, []);
  const tail = Array.isArray(stored) ? stored : [];
  const tailRows = tail.length;
  if (tailRows >= cap) return { rows: tail, tailRows };
  const full = kvGetJSONSync<T[]>(`chat_messages:${conversationId}`, []);
  if (!Array.isArray(full) || full.length <= tailRows) return { rows: tail, tailRows };
  const recent = full.length > cap ? full.slice(full.length - cap) : full;
  // The tail is written more often than the blob, so where both hold a row, the tail's copy wins.
  const merged = mergeHistory(tail, recent);
  return { rows: merged.length > cap ? merged.slice(merged.length - cap) : merged, tailRows };
}
