import React from 'react';
import { Redirect } from 'expo-router';

/**
 * The notifications inbox listed likes, comments and new followers — all three belonged to the
 * publishing and follower features, which were removed. Message notifications live on the chat
 * list itself (unread badges), the way a messenger shows them.
 *
 * The route stays as a redirect so an old push tap, an old in-app alert or a stale deep link lands
 * on the chats instead of an "unmatched route" screen.
 */
export default function NotificationsRedirect() {
  return <Redirect href="/(tabs)/messages" />;
}
