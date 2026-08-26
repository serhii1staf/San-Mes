import React from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';

/**
 * `/post/<id>` — the PUBLIC url shape, pointed at the screen that actually renders a post.
 *
 * ── WHY THIS FILE HAD TO EXIST ───────────────────────────────────────────────
 *
 * `/post/*` has been advertised as a universal link in `api/.well-known/apple-app-site-association.ts`
 * and minted into every share link by `openPostShareSheet` for a long time, while NOTHING in `app/`
 * matched it. So iOS would hand the URL to the app (the AASA said to) and expo-router had no route for
 * it. A post opened from a shared link went nowhere.
 *
 * The screen that renders a post with its thread is `app/comments/[id].tsx`. The two names disagreeing
 * is historical, and renaming the public shape is not an option: links already sent would break, and
 * Expo's docs are explicit that iOS caches the AASA at install/update time, so changing its `paths`
 * only reaches existing installs through a full App Store update — i.e. it is not OTA-deliverable at
 * all. https://docs.expo.dev/linking/ios-universal-links/
 *
 * So the public URL stays and this route bridges it.
 *
 * ── WHY `<Redirect>` AND NOT A `useEffect` + `router.replace` ────────────────
 *
 * `<Redirect>` is expo-router's documented redirect primitive: it behaves like `replace` and navigates
 * WITHOUT RENDERING the current page. That last part is the whole reason to prefer it here — an effect
 * would have to mount this screen, paint one frame of nothing, then navigate, which is a visible blank
 * flash on a cold deep-link open. https://docs.expo.dev/router/reference/redirects/
 *
 * Behaving like `replace` also means this route never sits in the stack, so backing out of the post
 * lands wherever the user actually came from instead of on a bridge that immediately forwards them
 * again. Same trap `app/u/[username].tsx` documents for the mention resolver.
 */
export default function PostLinkRedirect() {
  const { id } = useLocalSearchParams<{ id: string }>();

  // A malformed link (no id) goes to the feed rather than to an error screen. There is nothing for the
  // reader to act on and the feed is where they were heading.
  if (!id) return <Redirect href="/(tabs)" />;

  return <Redirect href={{ pathname: '/comments/[id]', params: { id } }} />;
}
