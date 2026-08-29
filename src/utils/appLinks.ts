import type { Href } from 'expo-router';
import { extractMiniAppShareId } from './miniAppShare';

/**
 * Our OWN links, and how to open them inside the app.
 *
 * ── THE PROBLEM THIS FILE EXISTS TO FIX ──────────────────────────────────────
 *
 * Sharing a post put `https://san-m-app.com/post/<id>` into a chat message. From there every path led
 * OUT of the app: the chat rendered it through the generic OG unfurl (`LinkPreview`), and tapping that
 * card pushed `/browser` — a WebView showing our own marketing page for a post the reader already has
 * an account for. Same for a shared profile.
 *
 * Expo Router documents exactly why this happens and it is not a bug in our code: a fully-qualified
 * `http`/`https` href is DELIBERATELY treated as a web address, because that is the documented way to
 * force a link into the user's browser. Staying in-app means handing the router a RELATIVE path
 * instead, i.e. stripping our own origin off the URL first.
 * https://docs.expo.dev/router/advanced/native-intent/ (§ Forcing web links)
 *
 * So this module owns two things and nothing else:
 *
 *   1. the SHAPES of our shareable URLs (one regex per kind, in one place), and
 *   2. the mapping from a shape to the in-app route that renders it.
 *
 * ── WHY THE PATHS AND THE ROUTES ARE NOT THE SAME STRINGS ────────────────────
 *
 * `/post/<id>` is the public URL we have been minting into share links and declaring in
 * `apple-app-site-association.ts` since long before this change. The screen that actually renders a
 * post with its thread is `app/comments/[id].tsx`. Those two disagreeing is why `/post/*` was
 * advertised as a universal link while being unroutable — nothing in `app/` matched it.
 *
 * Rather than renaming the public URL (which would break every link already sent, and per Expo's docs
 * an AASA `paths` change needs a full App Store update to reach existing installs, so it is not even
 * OTA-deliverable) the public shape stays and this table maps it onto the real screen. `app/post/[id]`
 * exists as a thin `<Redirect>` so an incoming universal link lands somewhere.
 * https://docs.expo.dev/linking/ios-universal-links/
 *
 * Mini-app links (`/m/<short>`, `/mini/<uuid>`) are deliberately ABSENT here — `miniAppShare.ts` has
 * owned that shape since the mini-app card shipped, and `LinkPreview` already dispatches on it.
 */

/** Every host we mint share links for. Kept as a list so a future domain is a one-line change. */
const SHARE_HOST_PATTERN = '(?:www\\.)?san-m-app\\.com';

/**
 * A post. The id is a UUID today, but the pattern accepts any url-safe id so a future short-code does
 * not need this file edited again.
 */
export const POST_SHARE_REGEX = new RegExp(
  `^https?://${SHARE_HOST_PATTERN}/post/([A-Za-z0-9_-]+)`,
  'i',
);

/** A profile BY ID — what `openProfileShareSheet` mints. */
export const PROFILE_SHARE_REGEX = new RegExp(
  `^https?://${SHARE_HOST_PATTERN}/profile/([A-Za-z0-9_-]+)`,
  'i',
);

/**
 * A profile BY USERNAME. Not currently minted by the share sheet, but `/u/<name>` is a real route (the
 * @mention resolver), so a link of this shape that arrives from anywhere should resolve in-app too.
 * Usernames allow dots and underscores, which ids do not.
 */
export const USERNAME_SHARE_REGEX = new RegExp(
  `^https?://${SHARE_HOST_PATTERN}/u/@?([A-Za-z0-9_.-]+)`,
  'i',
);

export function extractPostShareId(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(POST_SHARE_REGEX);
  return m ? m[1] : null;
}

export function extractProfileShareId(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(PROFILE_SHARE_REGEX);
  return m ? m[1] : null;
}

export function extractUsernameShareRef(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(USERNAME_SHARE_REGEX);
  return m ? m[1] : null;
}

/** Every http(s) URL in a string. Global counterpart to `linkPreview`'s single-match pattern. */
const ALL_URLS_RE = /https?:\/\/[^\s<>"')]+/gi;

/**
 * The first of OUR OWN links inside a block of text, or `null`.
 *
 * ── WHY "THE FIRST URL" WAS THE WRONG QUESTION ──────────────────────────────
 *
 * Both the feed card and the chat bubble picked their preview target with
 * `extractFirstUrl(text)` — literally the first http(s) match — and then asked whether THAT was one of
 * ours. The share sheet sends `caption + "\n" + shareUrl`, and the caption is the shared post's own
 * text (`ShareToChatSheet`: `const body = caption?.trim() ? caption.trim() + "\n" + shareUrl : shareUrl`).
 *
 * So when the shared post itself contained a link — someone sharing a post that quotes a YouTube video,
 * which is completely ordinary — the first URL in the message was the CAPTION'S link, not ours. Three
 * consequences, all at once:
 *
 *   `isInAppCardUrl(previewLink)` was false, so nothing stripped our URL and the bare
 *   `san-m-app.com/post` was printed in the body in green underlined link style;
 *
 *   the preview rendered the third party's OG card instead of the post being shared, so the card did
 *   not show the thing the sender sent;
 *
 *   and because the OG unfurl is a network fetch, that card arrived LATE — which is the "сначала
 *   появляется ссылка, и после этого уже идёт контейнер" in the report.
 *
 * Scanning for our own shape first fixes all three: the thing being SHARED is what the message is
 * about, so it wins the preview slot regardless of where it sits in the text, and it always gets
 * stripped because it is always the matched url.
 *
 * Returns the raw matched substring, not a normalised form, so callers can strip it from the text by
 * exact comparison.
 */
export function extractInAppCardUrl(text: string | null | undefined): string | null {
  if (!text) return null;
  // `matchAll` needs the global flag and a fresh iterator each call; the regex is module-level, so
  // `lastIndex` must not be allowed to leak between calls — `matchAll` handles that by throwing if the
  // pattern is not global and by not mutating `lastIndex` on the original.
  for (const m of text.matchAll(ALL_URLS_RE)) {
    if (isInAppCardUrl(m[0])) return m[0];
  }
  return null;
}

/**
 * Does this URL render as a full in-app CARD that replaces the link entirely?
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 *
 * Found by driving the app on a device rather than by reading code: a shared post rendered the
 * card correctly AND printed the bare `san-m-app.com/post` above it, in green underlined link
 * style. The card already shows the author, the text, the thumbnail and the counts, so the URL
 * line is pure noise — and because the label is elided it reads as a broken half-link.
 *
 * Deliberately scoped to OUR OWN links. A third-party URL keeps its text: for a YouTube or news
 * link the address is genuinely informative, and hiding it would be a product change nobody asked
 * for. For our own content the card IS the content.
 *
 * Mini-app links count too — `LinkPreview` dispatches those to `MiniAppPreviewCard`, which is the
 * same kind of full replacement.
 */
export function isInAppCardUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return (
    !!extractPostShareId(url) ||
    !!extractProfileShareId(url) ||
    !!extractUsernameShareRef(url) ||
    !!extractMiniAppShareId(url)
  );
}

/**
 * Body text with a previewed in-app URL removed. Returns `''` when the URL was all there was, so
 * callers can drop the text node entirely instead of rendering an empty line.
 *
 * Handles the captioned case as well as the bare one: the share sheet sends `caption + "\n" + url`,
 * so removing just the URL leaves the caption intact and tidies the whitespace it left behind.
 */
export function stripInAppCardUrl(
  text: string | null | undefined,
  url: string | null | undefined,
): string {
  if (!text) return '';
  // ── STRIPS EVERY ONE OF OUR OWN URLS, NOT JUST THE MATCHED ONE ─────────────
  //
  // The `url` argument is still honoured (it may be a mini-app link, whose shape lives in
  // `miniAppShare.ts`), but the sweep below is what makes the guarantee hold: "везде во всём
  // приложении, чтобы был только сам контейнер".
  //
  // Removing only the previewed url left the others behind, and a message can genuinely carry more
  // than one — forwarding a share, or a caption that itself quotes a profile link. Only one of them
  // becomes a card, so the rest were printed as bare elided links next to it, which reads as broken
  // rather than deliberate.
  //
  // Case-insensitive by construction: the extractors' regexes carry the `i` flag, so a link typed or
  // pasted with a capitalised host is matched here even though the exact-substring removal below
  // would have missed it.
  let out = text;
  if (url) {
    // `split`/`join` rather than a regex: the URL is data and may contain regex metacharacters.
    out = out.split(url).join('');
  }
  const ours: string[] = [];
  for (const m of out.matchAll(ALL_URLS_RE)) {
    if (isInAppCardUrl(m[0])) ours.push(m[0]);
  }
  for (const u of ours) out = out.split(u).join('');
  // Collapse the blank lines the removals leave behind and tidy the edges. A caption survives; a
  // message that was nothing but links becomes empty, so the caller can drop the text node entirely.
  return out
    .replace(/[ \t]+\r?\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Canonical share URL for a post. The one place this string is built. */
export function buildPostShareUrl(postId: string): string {
  return `https://san-m-app.com/post/${postId}`;
}

/** Canonical share URL for a profile. */
export function buildProfileShareUrl(profileId: string): string {
  return `https://san-m-app.com/profile/${profileId}`;
}

/**
 * Turn one of our own URLs into a router target, or return `null` when the URL is not ours.
 *
 * Returning `null` rather than throwing is the whole point: callers use this as a cheap "is this mine?"
 * test and fall through to their existing external-link behaviour, so adding the check to a call site
 * cannot change what happens to a third-party URL.
 *
 * Note the object form (`{ pathname, params }`) rather than an interpolated string. Expo Router
 * documents both, and the object form is the one that cannot be broken by an id containing a character
 * that means something in a path.
 * https://docs.expo.dev/router/basics/navigation/ (§ Dynamic routes and URL parameters)
 */
export function resolveInAppHref(url: string | null | undefined): Href | null {
  if (!url) return null;

  const postId = extractPostShareId(url);
  // `/comments/[id]`, not `/post/[id]`: the thread screen IS the post screen. See the note above.
  if (postId) return { pathname: '/comments/[id]', params: { id: postId } };

  const profileId = extractProfileShareId(url);
  if (profileId) return { pathname: '/profile/[id]', params: { id: profileId } };

  const username = extractUsernameShareRef(url);
  // ── WHY THIS ONE IS A STRING WITH A CAST AND THE OTHERS ARE NOT ────────────
  //
  // `.expo/types/router.d.ts` is a GENERATED file (expo-router's typed routes) and it is regenerated
  // by the dev server, not by `tsc`. It currently predates `app/u/[username].tsx`, so that route is
  // absent from the `Href` union and the object form does not typecheck — while `/comments/[id]` and
  // `/profile/[id]` are both in the union and need no cast at all, which is exactly the signal that
  // this is a stale-codegen issue and not a wrong path.
  //
  // Same shape `FormattedText` already uses for the mention tap (`router.push(\`/u/${name}\` as any)`),
  // kept consistent rather than inventing a second convention. `encodeURIComponent` because a username
  // is user-controlled input going into a path segment.
  if (username) return `/u/${encodeURIComponent(username)}` as Href;

  return null;
}
