/**
 * Helpers for the "single string with optional prefix" decoration
 * format shared between `useProfileAppearanceStore.postEmoji` and
 * any other surface that might let a user pick either an emoji or a
 * pixel icon (chat reply, post pattern, etc.).
 *
 * Format:
 *   ""                          → off
 *   "🌸" or "emoji:🌸"           → render as EmojiPattern
 *   "pixel:pack-1/01_ghost_king" → render as PixelIconPattern
 *
 * The unprefixed legacy form is kept on the read path forever so
 * users who picked an emoji before pixel icons existed don't lose
 * their decoration on the next launch. New writes from any surface
 * we control should use the explicit prefix — it's self-describing
 * in the persisted JSON.
 */

export type Decoration =
  | { kind: 'none' }
  | { kind: 'emoji'; value: string }
  | { kind: 'pixel'; id: string };

export function parseDecoration(raw: string | null | undefined): Decoration {
  if (!raw) return { kind: 'none' };
  if (raw.startsWith('pixel:')) {
    const id = raw.slice('pixel:'.length).trim();
    if (!id) return { kind: 'none' };
    return { kind: 'pixel', id };
  }
  if (raw.startsWith('emoji:')) {
    const v = raw.slice('emoji:'.length);
    if (!v) return { kind: 'none' };
    return { kind: 'emoji', value: v };
  }
  // Legacy unprefixed form — anything that isn't a `pixel:` lookup
  // is treated as an emoji codepoint, which is exactly what the old
  // store wrote.
  return { kind: 'emoji', value: raw };
}

export function emojiToken(emoji: string): string {
  // Persist with explicit prefix so future readers don't have to
  // guess. Empty string means "off" — handled at the call site.
  if (!emoji) return '';
  return `emoji:${emoji}`;
}

export function pixelToken(id: string): string {
  return `pixel:${id}`;
}
