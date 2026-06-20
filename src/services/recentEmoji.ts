// recentEmoji — a tiny most-recently-used emoji list, persisted per account in
// MMKV (kvStore applies the account namespace). Shown as a quick-pick row at
// the top of the chat media panel (both the emoji and the GIF tabs) so the
// emoji a user reaches for most are always one tap away — Telegram-style.

import { kvGetJSONSync, kvSetJSON } from './kvStore';

const KEY = 'recent_emoji';
const MAX = 24;

/** Read the MRU emoji list (most-recent first). Always returns an array. */
export function getRecentEmoji(): string[] {
  try {
    const a = kvGetJSONSync<string[]>(KEY, []);
    return Array.isArray(a) ? a.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Record a just-used emoji: move it to the front, dedupe, cap at MAX.
 * Returns the updated list so the caller can update React state in one hop.
 */
export function pushRecentEmoji(emoji: string): string[] {
  if (!emoji) return getRecentEmoji();
  const cur = getRecentEmoji();
  const next = [emoji, ...cur.filter((x) => x !== emoji)].slice(0, MAX);
  kvSetJSON(KEY, next);
  return next;
}
