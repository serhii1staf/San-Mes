import { apiGet } from './apiClient';
import { perfMonitor } from './perfMonitor';

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
    // ---- THE DIAGNOSTIC GOES WHERE IT WILL ACTUALLY BE SEEN ------------------
    //
    // The pack name and the blocking format have been reported in the UI for three rounds now, first
    // in grey micro-print and then in a bordered box, and not once has either come back to me. So the
    // UI is the wrong channel: asking a user to transcribe a diagnostic is a request that keeps not
    // being fulfilled, and every unfulfilled round costs another guess.
    //
    // The perf monitor IS the channel that works. Its snapshots get sent unprompted and in full, so a
    // failure recorded here arrives on its own with no transcription and no asking. Same reason the
    // long-task marks exist: the data has to travel by itself.
    if (error) {
      try { perfMonitor.recordError('stickerImport ' + link + ' -> ' + error); } catch {}
      // Missing bot token. A deployment fact, not a bad link: conflating the two would send the user off
      // editing a link that was fine.
      if (error.includes('not configured')) return { ok: false, reason: 'not_configured' };
      // Signed out / expired session. This used to fall through to "pack not found", which sent the user
      // to inspect a link that had nothing wrong with it.
      if (error.includes('unauthoris') || error.includes('unauthoriz')) return { ok: false, reason: 'unauthorised' };
      if (error.includes('no usable')) {
        // The Worker names the formats that blocked it after the colon (`.tgs`, `.webm`, …). Carried
        // through so the message can say which one, instead of "nothing works" — that distinction is what
        // decides whether the fix is a Lottie renderer or a transcode, and it is the user who can get us
        // that fact in one attempt.
        const idx = error.indexOf(':');
        return { ok: false, reason: 'empty', detail: idx >= 0 ? error.slice(idx + 1).trim() : undefined };
      }
      if (error.includes('unavailable') || error.includes('not found')) {
        // Everything after the colon is Telegram's own description — surfaced so a rate limit or a dead
        // token is distinguishable from a wrong name.
        const idx = error.indexOf(':');
        return { ok: false, reason: 'not_found', detail: idx >= 0 ? error.slice(idx + 1).trim() : undefined };
      }
      return { ok: false, reason: 'failed', detail: error };
    }

    // ── THIS BRANCH TOLD THE SAME LIE FOR WEEKS. IT REPORTS ITSELF NOW. ──────
    //
    // `reason: 'empty'` with no `detail` reads in the UI as "the set exists but none of its stickers can
    // be shown as an image" — a statement about FORMATS. But this branch is reached whenever the response
    // simply did not carry stickers, which has nothing to do with formats at all.
    //
    // That is exactly what happened: the Worker returned its payload through `jsonResponse` instead of
    // `ok`, so it arrived without the `{ data, error }` envelope, `apiClient` collapsed both to null, and
    // this line fired on every SUCCESSFUL import. The route had resolved every sticker correctly. Because
    // `error` was null, the branch above never ran, so the diagnostic I had put there could not fire
    // either — the failure was structurally incapable of reporting itself, which is why it survived
    // several rounds of me investigating formats.
    //
    // So the two causes are now separated and both are recorded. A null `data` with a null `error` is an
    // envelope or transport problem and says so; a present-but-empty list is a genuine content problem.
    if (!data) {
      try { perfMonitor.recordError('stickerImport ' + link + ' -> no data and no error (envelope/transport)'); } catch {}
      return { ok: false, reason: 'failed', detail: 'empty response' };
    }
    if (!Array.isArray(data.stickers) || data.stickers.length === 0) {
      try { perfMonitor.recordError('stickerImport ' + link + ' -> response carried 0 stickers'); } catch {}
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
