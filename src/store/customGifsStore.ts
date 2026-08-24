import { create } from 'zustand';
import { kvGetJSONSync, kvSetJSON } from '../services/kvStore';
import type { GiphyItem } from '../services/giphy';

/**
 * GIFs the user added themselves, by pasting a link.
 *
 * ── WHAT "IMPORT FROM OTHER SOCIAL NETWORKS" CAN AND CANNOT MEAN ───────────
 *
 * Asked for: a way to add your own GIFs, "import from other social networks, Telegram, Instagram and
 * the rest — you just paste a link".
 *
 * Pasting a link is exactly what this does, and for a DIRECT media link it works for every one of those
 * services: Telegram's file links, a Giphy or Tenor media URL, anything ending in a real image.
 *
 * What it deliberately does NOT do is take an Instagram POST page and dig the media out of it. That
 * needs their private API or HTML scraping, which is against their terms — and under the Apple
 * Developer Program License Agreement §3.3.4.A.i, shipping media obtained that way is infringing
 * third-party rights. The repo already carries this exact judgement about SoundCloud (see
 * `.kiro/steering/apple-compliance.md`, which flags our SoundCloud scraping as a submission risk to be
 * removed). Adding a second instance of the same problem to fix a convenience would be trading the
 * App Store listing for a paste step.
 *
 * So: direct media links, validated. When a link turns out to be a web page rather than an image, the
 * user is told to paste the image's own address, which is two taps in any browser or in Telegram.
 *
 * ── STORAGE ─────────────────────────────────────────────────────────────────
 *
 * MMKV via `kvStore`, which namespaces per account — so one person's stickers do not appear for another
 * account on a shared device. Entries are stored in the same `GiphyItem` shape the GIF grid already
 * renders, so nothing downstream needs to know these came from the user.
 */

const KEY = '@san:custom_gifs';

/** Plenty for a personal sticker set, and bounded so the grid and the MMKV blob stay small. */
const MAX_CUSTOM = 60;

interface CustomGifsState {
  items: GiphyItem[];
  /** Add a validated GIF. Newest first; re-adding an existing URL moves it to the front. */
  add: (url: string) => void;
  remove: (id: string) => void;
  /** Re-read from disk — used when the active account changes. */
  hydrate: () => void;
}

/**
 * A stable id derived from the URL, so re-adding the same GIF cannot produce a duplicate cell and the
 * `keyExtractor` in the grid stays unique. Not a hash — the URL itself is already unique, and keeping it
 * readable makes a stored blob debuggable.
 */
function idForUrl(url: string): string {
  return 'custom:' + url;
}

function load(): GiphyItem[] {
  const rows = kvGetJSONSync<GiphyItem[]>(KEY, []);
  return Array.isArray(rows) ? rows : [];
}

export const useCustomGifs = create<CustomGifsState>((set, get) => ({
  items: load(),

  add: (url) => {
    const clean = url.trim();
    if (!clean) return;
    const id = idForUrl(clean);
    const existing = get().items.filter((g) => g.id !== id);
    const item: GiphyItem = {
      id,
      // One URL for all three roles. A user-supplied GIF has no separate still frame or preview
      // rendition to point at, and inventing one would mean re-hosting or proxying their file.
      previewUrl: clean,
      sendUrl: clean,
      stillUrl: clean,
    } as GiphyItem;
    const next = [item, ...existing].slice(0, MAX_CUSTOM);
    set({ items: next });
    kvSetJSON(KEY, next);
  },

  remove: (id) => {
    const next = get().items.filter((g) => g.id !== id);
    set({ items: next });
    kvSetJSON(KEY, next);
  },

  hydrate: () => set({ items: load() }),
}));

/** Extensions we accept without asking the network. */
const DIRECT_MEDIA = /\.(gif|webp|png|jpe?g|apng)(\?|#|$)/i;

export type GifLinkResult =
  | { ok: true; url: string }
  | { ok: false; reason: 'empty' | 'not_https' | 'not_media' };

/**
 * Turn whatever the user pasted into a usable media URL.
 *
 * ── "HOW DOES IT WORK IN DISCORD THEN?" ─────────────────────────────────────
 *
 * Asked exactly that, after pasting a link copied from Discord's GIF picker and being told it was a web
 * page. It was a web page: Discord's "Copy Link" hands you a TENOR PAGE — `tenor.com/view/…-gif-12345`
 * — not the file. Discord shows the GIF because it RESOLVES that page. So did we need to, and did not.
 *
 * The resolution step is now here, and it is the same mechanism a page's author publishes it for: Open
 * Graph metadata. `og:image` on a Tenor page IS the GIF; on a Giphy page it is the GIF; on a Discord
 * CDN link it is the file itself. Reading tags a site puts in its own `<head>` for exactly this purpose
 * is not scraping a private API — it is the difference between this and the Instagram case, which needs
 * their internal endpoints and is therefore still refused.
 *
 * And we already had the machinery: `getLinkPreview` talks to our own `/api/unfurl`, which extracts
 * `og:image:secure_url` / `og:image` / `twitter:image` and absolutizes the result. It is the same
 * endpoint that renders link preview cards in chat, with the same cache — so the second person to paste
 * a popular GIF pays nothing.
 *
 * ── THE ORDER OF THE CHECKS, AND WHY ────────────────────────────────────────
 *
 *   1. HTTPS. Not a formality: ATS is at its iOS default, so an `http://` sticker would fail to load at
 *      runtime with no explanation at all. Rejecting it turns a silent broken image into a sentence.
 *   2. A recognised image extension → accept with no network at all. The common case is free.
 *   3. `HEAD` for the content type, because plenty of legitimate direct links carry no extension (CDN
 *      paths, signed URLs). `image/*` → accept.
 *   4. Otherwise unfurl it and take `og:image`. This is the Discord/Tenor/Giphy path.
 *
 * A failure at the end is a rejection rather than an optimistic accept: an entry that cannot load is
 * worse than one that was refused, because it lands in the grid looking permanent and the user has no
 * way to tell it from a slow one.
 */
export async function validateGifLink(raw: string): Promise<GifLinkResult> {
  const url = (raw || '').trim();
  if (!url) return { ok: false, reason: 'empty' };
  if (!/^https:\/\//i.test(url)) return { ok: false, reason: 'not_https' };
  if (DIRECT_MEDIA.test(url)) return { ok: true, url };

  // Step 3 — is it already a file, just without a telling extension?
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    let type = '';
    try {
      const resp = await fetch(url, { method: 'HEAD', signal: controller.signal });
      type = resp.headers.get('content-type') || '';
    } finally {
      clearTimeout(timer);
    }
    if (/^image\//i.test(type)) return { ok: true, url };
  } catch {
    // A failed HEAD says nothing conclusive — some hosts refuse the method outright. Fall through to
    // the unfurl attempt rather than rejecting here.
  }

  // Step 4 — a page. Ask it what image it advertises.
  try {
    const { getLinkPreview } = await import('../services/linkPreview');
    const preview = await getLinkPreview(url);
    const image = preview?.image;
    if (image && /^https:\/\//i.test(image)) return { ok: true, url: image };
  } catch {
    // fall through
  }

  return { ok: false, reason: 'not_media' };
}
