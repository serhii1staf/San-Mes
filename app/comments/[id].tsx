import React from 'react';
import { Redirect } from 'expo-router';

/**
 * Posts and comments were removed: San is a messenger now.
 *
 * The route file stays, as a redirect, because links to it still exist outside the app — shared
 * `/post/<id>` URLs (universal links, see `app/post/[id].tsx`), old push notifications and old
 * in-app alerts. Deleting the file would turn every one of those into an "unmatched route" screen.
 *
 * `<Redirect>` navigates without rendering this page and behaves like `replace`, so the bridge
 * never sits in the back stack. https://docs.expo.dev/router/reference/redirects/
 */
export default function CommentsRedirect() {
  return <Redirect href="/(tabs)/messages" />;
}
