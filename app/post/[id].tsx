import React from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';

/**
 * `/post/<id>` — the public share-link shape, declared as a universal link in
 * `api/.well-known/apple-app-site-association.ts`.
 *
 * Posts live on profiles again, so a shared post link opens that post's thread. Without an id it
 * falls back to the chats. `<Redirect>` navigates without rendering this page and behaves like
 * `replace`, so Back from the thread does not land on an empty screen.
 */
export default function PostLinkRedirect() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  if (id) return <Redirect href={{ pathname: '/comments/[id]', params: { id } }} />;
  return <Redirect href="/(tabs)/messages" />;
}
