import React from 'react';
import { Redirect } from 'expo-router';

/**
 * `/post/<id>` — the public share-link shape, still declared as a universal link in
 * `api/.well-known/apple-app-site-association.ts`.
 *
 * Posts were removed (San is a messenger now), so an old shared post link opens the chats instead
 * of an "unmatched route" screen. The AASA entry cannot be dropped over the air anyway: iOS caches
 * it at install/update time, so changing its `paths` only reaches devices with a new App Store
 * build. https://docs.expo.dev/linking/ios-universal-links/
 *
 * `<Redirect>` navigates without rendering this page and behaves like `replace`.
 */
export default function PostLinkRedirect() {
  return <Redirect href="/(tabs)/messages" />;
}
