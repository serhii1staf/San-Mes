// ── Telegram sticker-pack import ──────────────────────────────────────────
//
// Reported: pasting a Telegram sticker-pack link produced the Telegram LOGO instead of the stickers.
// Exactly right, and unavoidable by the route it took: the client resolved the link through Open Graph
// metadata, and `t.me/addstickers/<name>` advertises ONE `og:image` — the pack's cover art. A pack link
// identifies a SET; its page never lists the members. No amount of metadata reading gets you the
// stickers.
//
// Telegram publishes an official, documented way to enumerate a set: the Bot API's `getStickerSet`,
// followed by `getFile` per sticker. That needs a bot token, which is why this lives on the Worker.
//
// ── WHY THE TOKEN CANNOT GO IN THE APP, AND WHY THE FILES ARE PROXIED ─────
//
// Two separate leaks, both fatal, both avoided here.
//
// First, a token shipped inside the app binary is a token published: an OTA bundle and an IPA are both
// trivially unpackable, and whoever reads it owns the bot. So it is a Worker secret and never leaves the
// isolate.
//
// Second — and this is the one that is easy to miss — Telegram's own download URLs EMBED THE TOKEN:
//
//     https://api.telegram.org/file/bot<TOKEN>/<file_path>
//
// So simply returning the URLs `getFile` gives us would hand the token to every client that imported a
// pack, defeating the first precaution entirely. Instead this route returns URLs pointing at ITSELF, and
// `/v1/stickers/telegram/file` fetches the bytes with the token server-side and streams them back. The
// client never sees a token, and the sticker URLs it stores are stable, cacheable and ours.
//
// ── WHAT ACTUALLY RENDERS, STATED HONESTLY ────────────────────────────────
//
// Telegram has three kinds of pack and only one of them is an image format we can display:
//
//   static   `.webp`  → renders natively. Full quality, animated=false.
//   animated `.tgs`   → gzipped Lottie JSON. Not an image at all; needs a Lottie renderer.
//   video    `.webm`  → VP9 video. `expo-image` does not play it.
//
// For the two we cannot render, Telegram provides a static `thumbnail` per sticker, also `.webp`. We
// import that, so an animated pack arrives as a set of still stickers rather than as nothing or as a
// grid of broken cells. The response reports `animated` per pack so the client can say so plainly
// instead of leaving the user to wonder why their dancing sticker sits still.

import { jsonResponse, fail } from '../http';
import { register } from '../router';
import { Env } from '../db';

/** Bot API ceiling per set is 120; ours is lower so one import cannot flood the picker. */
const MAX_STICKERS = 60;

/**
 * Accepts what a user can actually copy:
 *   https://t.me/addstickers/<name>
 *   https://telegram.me/addstickers/<name>
 *   tg://addstickers?set=<name>
 *   <name>
 * Set names are `[A-Za-z0-9_]`, so anything else is rejected before it reaches Telegram.
 */
function parsePackName(raw: string): string | null {
  const s = (raw || '').trim();
  if (!s) return null;
  // `addemoji` too, not just `addstickers`. Telegram's custom-emoji packs share through that path, they
  // are returned by the SAME `getStickerSet` call (with `sticker_type: "custom_emoji"`), and a user
  // copying a link has no reason to know the two are different products. Rejecting it sent the link down
  // the single-image path, where it unfurled to Telegram's logo — the original complaint, in a second
  // disguise.
  const byUrl = s.match(/(?:t\.me|telegram\.me)\/add(?:stickers|emoji)\/([A-Za-z0-9_]+)/i);
  if (byUrl) return byUrl[1];
  const byScheme = s.match(/[?&]set=([A-Za-z0-9_]+)/i);
  if (byScheme) return byScheme[1];
  if (/^[A-Za-z0-9_]+$/.test(s)) return s;
  return null;
}

interface TgSticker {
  file_id: string;
  is_animated?: boolean;
  is_video?: boolean;
  emoji?: string;
  thumbnail?: { file_id: string };
  thumb?: { file_id: string };
}

/**
 * Call the Bot API. Returns the result AND Telegram's own description on failure.
 *
 * The description is carried through deliberately. The first version swallowed it and returned null, so
 * every possible failure — a name that does not exist, a rate limit, a revoked token — arrived at the app
 * as the single message "pack not found. Check the link, the pack may be private." That was reported as
 * "непонятно, что это", and rightly: it named one cause out of several and was wrong most of the time.
 *
 * Telegram's descriptions are diagnostic and contain nothing sensitive (`STICKERSET_INVALID`,
 * `Too Many Requests`, `Unauthorized`), so passing them on costs nothing and turns a guess into an answer.
 */
async function tg<T>(
  env: Env,
  method: string,
  params: Record<string, string>,
): Promise<{ result: T | null; detail: string }> {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) return { result: null, detail: 'no token' };
  const qs = new URLSearchParams(params).toString();
  let resp: Response;
  try {
    resp = await fetch(`https://api.telegram.org/bot${token}/${method}?${qs}`);
  } catch {
    return { result: null, detail: 'telegram unreachable' };
  }
  // Named rather than `typeof body`: after `let body: X | null = null`, `typeof body` narrows to `null`,
  // so the cast erased the shape and every property read became an error on `never`.
  type TgEnvelope = { ok?: boolean; result?: T; description?: string };
  let body: TgEnvelope | null = null;
  try {
    body = (await resp.json()) as TgEnvelope;
  } catch {
    return { result: null, detail: `bad response ${resp.status}` };
  }
  if (!body?.ok) return { result: null, detail: body?.description || `http ${resp.status}` };
  return { result: (body.result ?? null) as T | null, detail: '' };
}

// ── GET /v1/stickers/telegram?pack=<link|name> ────────────────────────────
//
// Deliberately UNAUTHENTICATED-tolerant on the data it touches: it reads a public sticker set and
// writes nothing. It still runs behind the same router as everything else, so the global auth
// middleware applies where configured.
register('GET', '/v1/stickers/telegram', async (req, env, _ctx, _params, authedUserId) => {
  // AUTHENTICATED, unlike the file proxy below. The data is public, so this is not about secrecy — it is
  // about our Telegram rate limit and our egress. An open enumeration endpoint is a free way for anyone
  // to spend both, and the only caller that legitimately exists is a signed-in user tapping "+".
  if (!authedUserId) return fail(req, 'unauthorised', 401);
  const url = new URL(req.url);
  const name = parsePackName(url.searchParams.get('pack') || '');
  if (!name) return fail(req, 'invalid pack link', 400);
  if (!env.TELEGRAM_BOT_TOKEN) {
    // A missing secret is a deployment fact, not a user error, and it must not read as "your link is
    // wrong" — that would send the user off editing a link that was fine.
    return fail(req, 'sticker import not configured', 503);
  }

  const got = await tg<{ name: string; title: string; sticker_type?: string; stickers: TgSticker[] }>(
    env,
    'getStickerSet',
    { name },
  );
  const set = got.result;
  if (!set || !Array.isArray(set.stickers)) {
    // Telegram's own words, so the app can tell a nonexistent pack from a rate limit from a dead token
    // instead of printing one guess for all three.
    return fail(req, 'pack unavailable: ' + (got.detail || 'unknown'), 404);
  }

  const wanted = set.stickers.slice(0, MAX_STICKERS);

  // ── ANIMATION IS A PER-STICKER FACT, NOT A PER-SET ONE ────────────────────
  //
  // This first read `set.is_animated` / `set.is_video`, and that was wrong against the live API. Verified
  // against `getStickerSet?name=HotCherry`: the SET object carries only `name`, `title`, `sticker_type`,
  // `contains_masks`, `thumb`, `thumbnail`, `stickers` — no animation flags at all. They live on each
  // STICKER (`is_animated: true`, `is_video: false`), which is where they are read from now.
  //
  // Left as-was, every animated pack would have looked static, we would have fetched the real `.tgs`
  // file, and the picker would have filled with cells that cannot render — the exact failure this branch
  // exists to prevent. Worth recording that the docs' set-level fields did not survive contact with the
  // API; only the per-sticker ones did.
  const animated = wanted.some((s) => !!s.is_animated || !!s.is_video);

  /** Static image formats we can display directly. */
  const STATIC_EXT = /\.(webp|png|jpe?g)$/i;
  /**
   * Animated Telegram stickers. NO LONGER A REJECTION.
   *
   * A `.tgs` is plain gzip around Lottie JSON — the container is packaging, not an encoding — so it needs
   * decompressing, not transcoding. The file proxy below gunzips it and serves `application/json`, and the
   * app renders it with `lottie-react-native`, which it already depends on.
   *
   * That is why this stopped being a dead end: the ready-made converters on GitHub all rasterize `.tgs`
   * into GIF/PNG with native binaries (rlottie, ffmpeg, puppeteer) and none of them can run in a Worker.
   * The part that IS reusable is the renderer we already ship. So an animated pack now arrives ANIMATED
   * rather than as a still thumbnail.
   */
  const LOTTIE_EXT = /\.tgs$/i;

  // One `getFile` per sticker, in parallel: a 60-sticker pack would otherwise be 60 sequential round
  // trips, and Telegram's limits are generous enough for a single import burst.
  const paths = await Promise.all(
    wanted.map(async (s) => {
      // -- TRY BOTH CANDIDATES, IN THE ORDER THE FLAGS SUGGEST --------------------
      //
      // This used to give up after ONE attempt when the flags said video: it resolved the thumbnail,
      // and if that came back non-static it rejected the sticker with no second try, because the
      // fallback was guarded by && !preferThumb.
      //
      // That is a real hole, and it is the shape of the remaining failure. Telegram VIDEO packs are
      // now the common kind, and a video sticker whose thumbnail ALSO resolves to .webm had nowhere
      // left to go: every sticker rejected, the whole pack refused, and the main file never even
      // examined - although for some packs that file is a perfectly ordinary .webp.
      //
      // Symmetric now: two candidates, ordered by what the flags suggest, first usable one wins. No
      // flag combination and no thumbnail format can leave a sticker unexamined. The second getFile
      // only happens when the first choice is unusable.
      const thumbId = s.thumbnail?.file_id || s.thumb?.file_id;
      const usable = (fp?: string) => !!fp && (STATIC_EXT.test(fp) || LOTTIE_EXT.test(fp));

      // Video first tries the thumbnail, because the real file is VP9 and iOS cannot decode it at
      // all. Everything else tries the real file first: .webp and .tgs both render, and a thumbnail
      // would be a needless downgrade.
      const order: string[] =
        s.is_video && thumbId ? [thumbId, s.file_id] : [s.file_id, ...(thumbId ? [thumbId] : [])];

      let p: string | undefined;
      let lastSeen: string | undefined;
      for (const candidate of order) {
        const got = (await tg<{ file_path?: string }>(env, 'getFile', { file_id: candidate })).result;
        const fp = got?.file_path;
        if (fp) lastSeen = fp;
        if (usable(fp)) { p = fp; break; }
      }
      // Nothing usable: keep the last path we DID see, so the rejection below can name its format
      // instead of reporting unresolved for a file that resolved perfectly well and was merely
      // the wrong kind.
      if (!p) p = lastSeen;

      // Rejected. Report WHAT was rejected rather than just failing: a pack that produces nothing
      // usable is otherwise indistinguishable from a pack that produced nothing at all, and the
      // difference is the whole question — "which format is blocking this" is what decides whether the
      // answer is a better fallback or a new renderer. See the 422 below.
      if (!p || (!STATIC_EXT.test(p) && !LOTTIE_EXT.test(p))) {
        const ext = p ? (p.match(/\.[a-z0-9]+$/i)?.[0] || 'no-ext') : 'unresolved';
        return { path: null as string | null, emoji: s.emoji || '', rejected: ext, lottie: false };
      }
      return { path: p as string | null, emoji: s.emoji || '', rejected: '', lottie: LOTTIE_EXT.test(p) };
    }),
  );

  const origin = url.origin;
  const stickers = paths
    .filter((p): p is { path: string; emoji: string; rejected: string; lottie: boolean } => !!p && !!p.path)
    // The URL points at US, never at Telegram — see the note above about the token being embedded in
    // Telegram's own download URLs.
    .map((p) => ({
      // mt=lottie is carried IN THE URL rather than only in this JSON, so that any consumer
      // holding just the url - a stored sticker, a chat message, an image cell - can still tell it
      // needs a Lottie renderer. The alternative was a parallel kind field that every layer would
      // have to remember to pass along, and one that forgets shows a blank cell.
      url:
        `${origin}/v1/stickers/telegram/file?path=${encodeURIComponent(p.path)}` +
        (p.lottie ? '&fmt=lottie' : ''),
      emoji: p.emoji,
      kind: p.lottie ? 'lottie' : 'image',
    }));

  if (stickers.length === 0) {
    // The pack exists but nothing in it resolved to a displayable image. Reported separately from
    // 'not found' because the user's link was correct and there is nothing for them to fix - AND
    // with the offending formats named, because that is the fact that decides what to build next.
    // A .tgs answer is a Lottie renderer (the app already depends on lottie-react-native); a
    // .webm answer is VP9, which iOS cannot decode at all and would need transcoding. Without
    // this line the two are indistinguishable and the next step is a guess.
    const kinds = Array.from(new Set(paths.map((p) => p?.rejected).filter(Boolean))).join(', ');
    return fail(req, 'pack has no usable stickers: ' + (kinds || 'unknown format'), 422);
  }

  return jsonResponse(req, {
    name: set.name,
    title: set.title,
    animated,
    count: stickers.length,
    stickers,
  });
});

// ── GET /v1/stickers/telegram/file?path=<file_path> ───────────────────────
//
// The proxy that keeps the token server-side. `file_path` comes from `getFile` and is opaque to the
// client; it is validated here anyway so this cannot be turned into a general-purpose fetcher for
// arbitrary paths on Telegram's host.
//
// DELIBERATELY PUBLIC, unlike the metadata route. It has to be: these URLs are handed to `expo-image`,
// which fetches them with no Authorization header and no way to add one — an authenticated proxy would
// mean every imported sticker renders as a broken cell. The exposure is bounded to what it is: bytes of
// a PUBLIC Telegram sticker set, reachable by anyone from Telegram directly, addressed by a
// content-addressed path this route cannot be talked out of. `immutable` caching means Cloudflare's edge
// absorbs repeats, so it cannot be used as an open relay of any volume either.
register('GET', '/v1/stickers/telegram/file', async (req, env) => {
  const url = new URL(req.url);
  const path = url.searchParams.get('path') || '';
  // Telegram file paths look like `stickers/file_123.webp`. Refuse traversal, absolute URLs and
  // anything with a character that has no business in one.
  if (!path || !/^[A-Za-z0-9_\-./]+$/.test(path) || path.includes('..')) {
    return fail(req, 'invalid path', 400);
  }
  // NOTE: `fmt=lottie` on the URL is informational for the CLIENT, not an instruction to this route. What
  // gets gunzipped is decided by the path's own extension below, so a tampered `fmt` cannot make this
  // route mis-handle a file.
  if (!env.TELEGRAM_BOT_TOKEN) return fail(req, 'sticker import not configured', 503);

  const upstream = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${path}`);
  if (!upstream.ok || !upstream.body) return fail(req, 'sticker unavailable', 502);

  // Streamed rather than buffered: a sticker is small, but streaming costs nothing and keeps the
  // isolate's memory flat regardless of what a pack contains.
  //
  // Cached hard and immutably. A Telegram `file_path` is content-addressed — the bytes behind one never
  // change — so this can sit on Cloudflare's edge for a year and every import after the first is served
  // without touching Telegram at all. That also means the picker keeps working if Telegram is briefly
  // unreachable.
  // ── CONTENT TYPE COMES FROM THE EXTENSION, NOT FROM TELEGRAM ──────────────
  //
  // Verified against the live endpoint: Telegram serves sticker files as `application/octet-stream`.
  // Passing that through would hand `expo-image` a blob with no declared image type, which is a decode
  // refusal on both platforms — every imported sticker would have arrived as an empty cell.
  //
  // The extension is trustworthy here in a way it usually is not: the path was produced by Telegram's own
  // `getFile` and is validated by the regex above, so it is not user input being sniffed.
  const lower = path.toLowerCase();

  // ── `.tgs` IS GUNZIPPED HERE, AND THAT IS THE WHOLE TRICK ─────────────────
  //
  // A `.tgs` is plain gzip around Lottie JSON. So an animated Telegram sticker does not need
  // transcoding, rasterizing or a native binary — it needs `gunzip`, which the Workers runtime provides
  // as `DecompressionStream('gzip')`. Out comes ordinary Lottie JSON, which `lottie-react-native` (already
  // a dependency of the app) renders directly.
  //
  // This is why the ready-made tools did not apply: every `.tgs`→GIF converter on GitHub rasterizes with
  // rlottie or ffmpeg or headless Chrome, none of which can run in a Worker. The reusable part was never
  // the converter, it was the renderer we already ship — so nothing is converted at all.
  //
  // Streamed, so a Worker never holds a whole animation in memory, and cached `immutable` exactly like the
  // image path: the `file_path` is content-addressed, so the decompressed bytes are as permanent as the
  // compressed ones.
  if (lower.endsWith('.tgs')) {
    let json: ReadableStream<Uint8Array>;
    try {
      json = upstream.body.pipeThrough(new DecompressionStream('gzip'));
    } catch {
      // A `.tgs` that is not actually gzipped is malformed. Reported rather than served as garbage that
      // the renderer would fail on with no explanation.
      return fail(req, 'sticker not decodable', 502);
    }
    return new Response(json, {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'public, max-age=31536000, immutable',
        'access-control-allow-origin': '*',
      },
    });
  }

  const type = lower.endsWith('.png')
    ? 'image/png'
    : lower.endsWith('.jpg') || lower.endsWith('.jpeg')
      ? 'image/jpeg'
      : 'image/webp';

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'content-type': type,
      'cache-control': 'public, max-age=31536000, immutable',
      'access-control-allow-origin': '*',
    },
  });
});
