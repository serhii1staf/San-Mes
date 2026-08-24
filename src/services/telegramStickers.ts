import { apiGet } from './apiClient';

/**
 * Import a Telegram sticker pack.
 *
 * ── WHY THIS GOES THROUGH OUR WORKER ────────────────────────────────────────
 *
 * A pack link identifies a SET, and nothing about the page reveals its members — that is why resolving
 * `t.me/addstickers/<name>` through Open Graph produced the Telegram logo: `og:image` there is the pack's
 * cover art. Enumerating a set needs Telegram's official Bot API (`getStickerSet` + `getFile`), which
 * needs a bot token.
 *
 * The token lives as a Worker secret and never reaches the app. That is not merely a matter of keeping it
 * out of a JSON response: Telegram's own download URLs EMBED the token, so the Worker proxies the sticker
 * bytes rather than handing those URLs out. The URLs that arrive here point at our Worker.
 *
 * See `workers/api/src/routes/stickers.ts`.
 */

export interface ImportedPack {
  name: string;
  title: string;
  /**
   * True for `.tgs` (Lottie) and `.webm` (video) packs. Those formats are not images and cannot be
   * displayed, so the Worker substitutes each sticker's static thumbnail — the pack imports and looks
   * right, it just does not move. Surfaced so the UI can SAY that rather than leaving the user to
   * wonder why their dancing sticker sits still.
   */
  animated: boolean;
  urls: string[];
}

export type ImportFailure =
  | 'not_a_pack'
  /** Telegram says the set does not exist. The link is genuinely wrong. */
  | 'not_found'
  /** The set exists but nothing in it resolved to a displayable image. Nothing for the user to fix. */
  | 'empty'
  /** Signed out or token expired — the app's problem, not the link's. */
  | 'unauthorised'
  /** Bot token missing on the Worker. */
  | 'not_configured'
  | 'failed';

export type ImportResult =
  | { ok: true; pack: ImportedPack }
  /**
   * `detail` carries Telegram's own words when there are any (`STICKERSET_INVALID`,
   * `Too Many Requests`, …). Shown in small print under the error, because the first version reported
   * every possible cause as "pack not found, it may be private" — one guess out of several, wrong most
   * of the time, and reported back as "непонятно, что это".
   */
  | { ok: false; reason: ImportFailure; detail?: string };

/** Does this look like a Telegram sticker-pack link at all? Cheap, so the UI can branch before asking. */
export function isTelegramPackLink(raw: string): boolean {
  const s = (raw || '').trim();
  if (!s) return false;
  // `addemoji` as well as `addstickers`: custom-emoji packs share through that path and come back from the
  // same `getStickerSet` call. Excluding them sent such a link down the single-image route, where it
  // unfurled to Telegram's logo — the original complaint wearing a different hat. Kept in step with
  // `parsePackName` on the Worker.
  return /(?:t\.me|telegram\.me)\/add(?:stickers|emoji)\/[A-Za-z0-9_]+/i.test(s) || /tg:\/\/add(?:stickers|emoji)\?set=/i.test(s);
}

export async function importTelegramPack(link: string): Promise<ImportResult> {
  if (!isTelegramPackLink(link)) return { ok: false, reason: 'not_a_pack' };
  try {
    const { data, error } = await apiGet<{
      name: string;
      title: string;
      animated: boolean;
      count: number;
      stickers: { url: string; emoji: string }[];
    }>(`/v1/stickers/telegram?pack=${encodeURIComponent(link)}`);

    // Branched on the Worker's error MESSAGE rather than an HTTP status, because `ApiResponse` exposes
    // only `{ data, error }`. That is the established pattern here — `apiClient`'s own notes point out
    // that callers branch on shapes like `'unauthorised'` — and the Worker's strings are fixed at the
    // route, so this is as stable as a status code would be.
    if (error) {
      // Missing bot token. A deployment fact, not a bad link: conflating the two would send the user off
      // editing a link that was fine.
      if (error.includes('not configured')) return { ok: false, reason: 'not_configured' };
      // Signed out / expired session. This used to fall through to "pack not found", which sent the user
      // to inspect a link that had nothing wrong with it.
      if (error.includes('unauthoris') || error.includes('unauthoriz')) return { ok: false, reason: 'unauthorised' };
      if (error.includes('no usable')) return { ok: false, reason: 'empty' };
      if (error.includes('unavailable') || error.includes('not found')) {
        // Everything after the colon is Telegram's own description — surfaced so a rate limit or a dead
        // token is distinguishable from a wrong name.
        const idx = error.indexOf(':');
        return { ok: false, reason: 'not_found', detail: idx >= 0 ? error.slice(idx + 1).trim() : undefined };
      }
      return { ok: false, reason: 'failed', detail: error };
    }
    if (!data || !Array.isArray(data.stickers) || data.stickers.length === 0) {
      return { ok: false, reason: 'empty' };
    }

    return {
      ok: true,
      pack: {
        name: data.name,
        title: data.title,
        animated: !!data.animated,
        urls: data.stickers.map((s) => s.url).filter(Boolean),
      },
    };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}
