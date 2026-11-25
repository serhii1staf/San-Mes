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

import { ok, fail } from '../http';
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

// ── TELEGRAM'S FILE PATHS EXPIRE; OUR COPY DOES NOT (Nov 2026) ─────────────
//
// Reported: stickers sent a while ago disappear, for both people in the chat. A sticker URL named a
// Telegram `file_path`, and Telegram guarantees one for about an hour; after that `getFile` has to be
// called again with the file id for a new one. Only the path was kept, so once it expired this proxy
// answered 502 and the sticker became an empty box in every chat it had been sent to.
//
// Now a sticker's bytes are kept in R2 (the media bucket, under `tg-stickers/<path>`) the first time
// anyone fetches them, and an import copies its whole pack right away. New URLs also carry the file
// id, so a sticker whose copy is missing can still be fetched by a fresh path. An old URL without an
// id cannot be recovered once Telegram has dropped its path: it answers 410 Gone.
const R2_PREFIX = 'tg-stickers/';
/** Telegram's own limits are 512 KB for a static sticker and 64 KB for an animated one. */
const MAX_STICKER_BYTES = 4 * 1024 * 1024;
/** The Lottie JSON inside a `.tgs` is several times the gzip. */
const MAX_LOTTIE_JSON_BYTES = 16 * 1024 * 1024;
const FILE_ID = /^[A-Za-z0-9_-]{8,256}$/;
/**
 * External requests one invocation may make, less a margin: 50 on the Free plan. Calls to R2 (and D1)
 * count against a separate limit of 1,000 for Cloudflare services, so only Telegram calls are counted.
 */
const OUTBOUND_BUDGET = 48;

/** A Telegram file path as `getFile` gives them (`stickers/file_123.webp`), and nothing else. */
function isSafePath(p: string): boolean {
  return !!p && /^[A-Za-z0-9_\-./]+$/.test(p) && !p.includes('..');
}

/**
 * The content type for a path, from its extension. Telegram serves sticker files as
 * `application/octet-stream`, which `expo-image` refuses to decode; the path comes from Telegram's
 * own `getFile` and is checked by `isSafePath`, so its extension can be trusted here. A `.tgs` is
 * served as the Lottie JSON inside it.
 */
function stickerType(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.tgs')) return 'application/json';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  return 'image/webp';
}

/**
 * The bytes behind a Telegram file path, or null when Telegram no longer has them.
 *
 * A `.tgs` is gunzipped here: it is plain gzip around Lottie JSON, which `lottie-react-native` (already
 * in the app) renders as it is. Nothing is transcoded. Buffered rather than streamed, so the same
 * bytes can go to the client and into R2; a sticker is small enough for that.
 */
async function fetchStickerBytes(env: Env, path: string): Promise<ArrayBuffer | null> {
  if (!env.TELEGRAM_BOT_TOKEN) return null;
  let res: Response;
  try {
    res = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${path}`);
  } catch {
    return null;
  }
  if (!res.ok || !res.body) return null;
  if (Number(res.headers.get('content-length') || '0') > MAX_STICKER_BYTES) return null;
  try {
    const lottie = path.toLowerCase().endsWith('.tgs');
    const body = lottie ? res.body.pipeThrough(new DecompressionStream('gzip')) : res.body;
    const bytes = await new Response(body).arrayBuffer();
    const max = lottie ? MAX_LOTTIE_JSON_BYTES : MAX_STICKER_BYTES;
    return bytes.byteLength > 0 && bytes.byteLength <= max ? bytes : null;
  } catch {
    // A `.tgs` that is not gzip, or a body cut off in transit: nothing a renderer could use.
    return null;
  }
}

function stickerResponse(body: ReadableStream | ArrayBuffer, type: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': type,
      // The bytes behind a path never change, so clients and proxies may keep them for good.
      'cache-control': 'public, max-age=31536000, immutable',
      'access-control-allow-origin': '*',
    },
  });
}

/** Copies an import's stickers into R2, a few at a time, skipping any already there. */
async function keepStickers(env: Env, paths: string[]): Promise<void> {
  const bucket = env.STICKERS;
  if (!bucket || !env.TELEGRAM_BOT_TOKEN) return;
  const AT_ONCE = 6;
  for (let i = 0; i < paths.length; i += AT_ONCE) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.all(
      paths.slice(i, i + AT_ONCE).map(async (path) => {
        if (!isSafePath(path)) return;
        const key = R2_PREFIX + path;
        try {
          if (await bucket.head(key)) return;
          const bytes = await fetchStickerBytes(env, path);
          if (bytes) await bucket.put(key, bytes, { httpMetadata: { contentType: stickerType(path) } });
        } catch {
          // Best effort: the file route copies anything missed the first time it is shown.
        }
      }),
    );
  }
}

// ── GET /v1/stickers/telegram?pack=<link|name> ────────────────────────────
//
// Deliberately UNAUTHENTICATED-tolerant on the data it touches: it reads a public sticker set and
// writes nothing. It still runs behind the same router as everything else, so the global auth
// middleware applies where configured.
register('GET', '/v1/stickers/telegram', async (req, env, ctx, _params, authedUserId) => {
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

  // ── BOUNDED CONCURRENCY. NOT THE BUG — I CHECKED. ─────────────────────────
  //
  // This was `Promise.all(wanted.map(...))`: up to sixty `getFile` calls at once, under a comment claiming
  // "Telegram's limits are generous enough for a single import burst". I suspected that claim was the
  // whole failure — a rate-limited burst would make every `getFile` return empty, every sticker be
  // rejected as unresolvable, and the route answer 422, which is exactly the reported symptom.
  //
  // SO I TESTED IT instead of shipping the theory: forty parallel `getFile` calls against a real
  // forty-sticker pack, fired simultaneously with `curl --parallel`. All forty returned 200 with valid
  // `file_path`s. No throttling, no 429. The hypothesis was wrong and the rate limit is not the cause.
  //
  // The bounding stays anyway, because it is correct on its own terms — an unbounded fan-out to a third
  // party is a coin toss against limits that are not ours to guarantee, and eight in flight costs a
  // sixty-sticker import a few extra seconds it can afford. But it is NOT a fix for the import failure,
  // and it must not be recorded as one.
  const CONCURRENCY = 8;
  const paths: Array<{ path: string | null; id: string; emoji: string; rejected: string; lottie: boolean } | null> = [];
  // Calls to Telegram so far (getStickerSet, then each getFile), for the copy's budget below.
  let telegramCalls = 1;
  for (let i = 0; i < wanted.length; i += CONCURRENCY) {
    const slice = wanted.slice(i, i + CONCURRENCY);
    // eslint-disable-next-line no-await-in-loop
    const settled = await Promise.all(
      slice.map(async (s) => {
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
      // The file id that produced `p`, for the URL: with it the file route can ask for a fresh path
      // once this one has expired (see "TELEGRAM'S FILE PATHS EXPIRE" below).
      let pId = '';
      let lastSeen: string | undefined;
      for (const candidate of order) {
        telegramCalls++;
        const got = (await tg<{ file_path?: string }>(env, 'getFile', { file_id: candidate })).result;
        const fp = got?.file_path;
        if (fp) lastSeen = fp;
        if (usable(fp)) { p = fp; pId = FILE_ID.test(candidate) ? candidate : ''; break; }
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
        return { path: null as string | null, id: '', emoji: s.emoji || '', rejected: ext, lottie: false };
      }
      return { path: p as string | null, id: pId, emoji: s.emoji || '', rejected: '', lottie: LOTTIE_EXT.test(p) };
      }),
    );
    paths.push(...settled);
  }

  const origin = url.origin;
  const resolved = paths.filter(
    (p): p is { path: string; id: string; emoji: string; rejected: string; lottie: boolean } => !!p && !!p.path,
  );
  const stickers = resolved
    // The URL points at US, never at Telegram — see the note above about the token being embedded in
    // Telegram's own download URLs.
    .map((p) => ({
      // mt=lottie is carried IN THE URL rather than only in this JSON, so that any consumer
      // holding just the url - a stored sticker, a chat message, an image cell - can still tell it
      // needs a Lottie renderer. The alternative was a parallel kind field that every layer would
      // have to remember to pass along, and one that forgets shows a blank cell.
      //
      // `id` is Telegram's file id: useless without our bot token, and what lets the file route get
      // a fresh path for this sticker after the one in the URL has expired.
      url:
        `${origin}/v1/stickers/telegram/file?path=${encodeURIComponent(p.path)}` +
        (p.id ? `&id=${encodeURIComponent(p.id)}` : '') +
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
    // The pack's SHORT NAME goes in too. The formats alone say what kind of problem it is; the name is
    // what makes it reproducible — with it, the pack can be queried directly through the Bot API instead
    // of being guessed at from a description. Two rounds of guessing pack names is what this replaces.
    //
    // Also reported: how many stickers had no thumbnail at all. Per the Bot API a sticker's `thumbnail` is
    // OPTIONAL and, when present, is `.webp` or `.jpg` — always static. So "video pack" alone does not
    // explain a total failure; "video pack whose stickers carry no thumbnail" does, and these two numbers
    // tell those apart.
    const noThumb = wanted.filter((s) => !s.thumbnail?.file_id && !s.thumb?.file_id).length;
    return fail(
      req,
      `pack has no usable stickers: ${kinds || 'unknown format'} [${set.name}, ${wanted.length} stickers, ${noThumb} without thumbnail]`,
      422,
    );
  }

  // ── `ok()`, NOT `jsonResponse()`. THIS ONE WORD WAS THE ENTIRE BUG. ───────
  //
  // `jsonResponse` writes the body VERBATIM. `ok` wraps it in the `{ data, error }` envelope that every
  // caller in this codebase destructures — see the header of `http.ts`, which states that both Supabase
  // and Worker responses share that shape precisely so callers can keep one `if (error)` / `data?.thing`
  // pattern.
  //
  // This route returned the payload bare. So `apiClient` did:
  //
  //     return { data: body.data ?? null, error: body.error ?? null };
  //
  // against a body of `{ name, title, animated, count, stickers }` — which has NEITHER key. Both
  // collapsed to null, and the client's next line is:
  //
  //     if (!data || ...) return { ok: false, reason: 'empty' };
  //
  // So EVERY SUCCESSFUL IMPORT was reported as an empty pack. The user's message — "the set exists but
  // none of its stickers can be shown as an image" — was produced by a response that had just
  // successfully resolved every sticker in the set.
  //
  // Worth recording how long this hid, because the reason is instructive. The failure named a format
  // problem, so I went after formats: I verified static (`.webp`), animated (`.tgs` → gunzip + Lottie)
  // and video (`.webm` → static thumbnail) end to end against the live Bot API, tested and discarded a
  // rate-limit theory, and made the candidate ordering symmetric. All of that was real work on a path
  // that was already returning correct data. None of it could ever have changed the outcome.
  //
  // The 422 below uses `fail`, which DOES wrap. That asymmetry is what made the bug look like a format
  // problem: genuine errors arrived intact and legible, while success arrived indistinguishable from the
  // one error that has no detail to print.
  //
  // The pack's bytes go into R2 while its paths are fresh, after the answer has been sent, so the
  // import is no slower. A sticker this misses is copied by the file route the first time it is shown.
  //
  // Within what is left of this request's external budget (`OUTBOUND_BUDGET`): the import has already
  // spent one per Telegram call. Measured on a 34-sticker pack (35 calls), exactly the 15 the limit
  // left were copied and the rest failed. The rest are copied by the file route, each in its own
  // request, and a sticker whose path expires first is fetched again by its file id.
  const copyBudget = Math.max(0, OUTBOUND_BUDGET - telegramCalls);
  ctx.waitUntil(keepStickers(env, resolved.map((p) => p.path).slice(0, copyBudget)));

  return ok(req, {
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
//
// Served from our R2 copy when there is one, else from Telegram, which is then copied. See
// "TELEGRAM'S FILE PATHS EXPIRE" above for why the copy exists.
register('GET', '/v1/stickers/telegram/file', async (req, env, ctx) => {
  const url = new URL(req.url);
  const path = url.searchParams.get('path') || '';
  // Telegram file paths look like `stickers/file_123.webp`. Refuse traversal, absolute URLs and
  // anything with a character that has no business in one.
  if (!isSafePath(path)) return fail(req, 'invalid path', 400);
  // Telegram's file id, on URLs made since Nov 2026 (see "TELEGRAM'S FILE PATHS EXPIRE" above).
  const fileId = url.searchParams.get('id') || '';
  if (fileId && !FILE_ID.test(fileId)) return fail(req, 'invalid id', 400);
  // NOTE: `fmt=lottie` on the URL is informational for the CLIENT, not an instruction to this route. What
  // gets gunzipped is decided by the path's own extension, so a tampered `fmt` cannot make this route
  // mis-handle a file.
  const type = stickerType(path);
  const key = R2_PREFIX + path;

  // 1. Our copy. Keyed by the path in the URL, so a sticker keeps answering at the URL it was sent
  //    with, whatever path Telegram gives the same file later.
  if (env.STICKERS) {
    try {
      const kept = await env.STICKERS.get(key);
      if (kept) return stickerResponse(kept.body, type);
    } catch {
      // R2 unavailable: Telegram below, as before the copy existed.
    }
  }
  if (!env.TELEGRAM_BOT_TOKEN) return fail(req, 'sticker import not configured', 503);

  // 2. Telegram, by the path in the URL; then, when the URL carries the file id, by a fresh path. The
  //    fresh one must be the same kind of file, or the bytes would be stored and served under the
  //    wrong type.
  let bytes = await fetchStickerBytes(env, path);
  if (!bytes && fileId) {
    const fresh = (await tg<{ file_path?: string }>(env, 'getFile', { file_id: fileId })).result?.file_path || '';
    if (isSafePath(fresh) && stickerType(fresh) === type) bytes = await fetchStickerBytes(env, fresh);
  }
  // Gone for good without an id; with one, Telegram may only be failing for now.
  if (!bytes) return fail(req, 'sticker unavailable', fileId ? 404 : 410);

  // 3. Keep it, after answering.
  if (env.STICKERS) {
    const bucket = env.STICKERS;
    // Its own buffer: the response below reads `bytes` while this write is still running.
    const copy = bytes.slice(0);
    ctx.waitUntil(
      bucket.put(key, copy, { httpMetadata: { contentType: type } }).then(
        () => undefined,
        () => undefined,
      ),
    );
  }
  return stickerResponse(bytes, type);
});
