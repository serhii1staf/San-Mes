/**
 * What KIND of media is behind a URL — specifically, can it carry transparency?
 *
 * ── WHY THIS IS A SHARED MODULE NOW ─────────────────────────────────────────
 *
 * It lived inside `app/chat/[id].tsx` as a module-local function with one caller. Then the long-press
 * menu needed exactly the same answer, for exactly the same reason: a cut-out sticker must not be given
 * a background, and the menu was painting an opaque white card behind one.
 *
 * Copying the rule into the menu would have guaranteed the two drift apart, and the drift would be
 * invisible — a sticker framed correctly in the thread and framed wrongly the moment you hold it, with
 * no single place to look. So the rule is one function, imported by both.
 */

/**
 * Can this URL plausibly carry transparency, i.e. is it a sticker rather than a photograph or a clip?
 *
 * Alpha itself cannot be known without decoding the bytes, so this goes by SOURCE. The two rules below
 * are the ones that survived contact with real content:
 *
 *   • `/v1/stickers/`  our Telegram sticker proxy. Always a cut-out. Note the extension lives in the
 *                      `path` QUERY PARAMETER (`?path=stickers%2Ffile_68.webp`), and the suffix test
 *                      below deliberately strips the query — so this check, not the suffix, is what
 *                      classifies every imported sticker.
 *   • `.webp` / `.png` the formats a cut-out is actually authored in. You reach for PNG or WebP
 *                      BECAUSE you need an alpha channel.
 *
 * Deliberately NOT matched, and both exclusions were reported bugs:
 *
 *   • `.jpg`           JPEG has no alpha channel at all, so it can never be a cut-out. This is the
 *                      "my own photos from the phone" case, which must keep its frame.
 *   • giphy / tenor    matched by HOST in an earlier version, which was wrong in the common case: a
 *                      GIF from a GIF site is a rectangular, fully opaque clip.
 *   • `.gif`           a real trade rather than a clean win. Transparent GIFs were asked for
 *                      explicitly, but they are rare, while opaque ones are the norm — and since a
 *                      cut-out also loses its corner radius, misclassifying a clip produces a raw
 *                      sharp-cornered rectangle on the chat background, which is what got reported.
 *                      Telegram imports, the actual source of cut-outs here, are `.webp` behind
 *                      `/v1/stickers/` and are caught by the first rule regardless.
 */
export function isCutoutCapableUrl(u: string): boolean {
  if (!u || typeof u !== 'string') return false;
  const low = u.toLowerCase();
  if (low.indexOf('/v1/stickers/') !== -1) return true;
  const q = low.indexOf('?');
  const path = q >= 0 ? low.slice(0, q) : low;
  return path.endsWith('.webp') || path.endsWith('.png');
}

/**
 * Is this message nothing but cut-out media — a sticker sent on its own?
 *
 * The shape both the bubble and the long-press menu need: media present, every url a cut-out, and no
 * text, quote or attachment that would need a surface to sit on. Anything else keeps its container.
 *
 * Every url has to qualify so a mixed group falls back to a normal container rather than leaving one
 * photo of several unframed.
 */
export function isCutoutOnlyMessage(m: {
  imageUrls?: string[] | null;
  text?: string | null;
  replyToText?: string | null;
  replyToImage?: string | null;
  replyPixelIconId?: string | null;
}): boolean {
  return (
    !!m.imageUrls &&
    m.imageUrls.length > 0 &&
    !m.text &&
    !m.replyToText &&
    !m.replyToImage &&
    !m.replyPixelIconId &&
    m.imageUrls.every(isCutoutCapableUrl)
  );
}
