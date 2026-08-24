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

export type ImportResult =
  | { ok: true; pack: ImportedPack }
  | { ok: false; reason: 'not_a_pack' | 'not_found' | 'not_configured' | 'failed' };

/** Does this look like a Telegram sticker-pack link at all? Cheap, so the UI can branch before asking. */
export function isTelegramPackLink(raw: string): boolean {
  const s = (raw || '').trim();
  if (!s) return false;
  return /(?:t\.me|telegram\.me)\/addstickers\/[A-Za-z0-9_]+/i.test(s) || /tg:\/\/addstickers\?set=/i.test(s);
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
      if (error.includes('not found') || error.includes('no usable')) return { ok: false, reason: 'not_found' };
      return { ok: false, reason: 'failed' };
    }
    if (!data || !Array.isArray(data.stickers) || data.stickers.length === 0) {
      return { ok: false, reason: 'failed' };
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
