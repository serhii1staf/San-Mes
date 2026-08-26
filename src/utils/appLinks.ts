import type { Href } from 'expo-router';

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
