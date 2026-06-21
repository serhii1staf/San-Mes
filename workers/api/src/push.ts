// Expo push fan-out.
//
// The app registers an Expo push token per device (POST /v1/push/register,
// stored in the `push_tokens` table). When something happens that the
// recipient should be told about off-screen (new DM, comment on their post,
// new follower) we POST the message(s) to the Expo Push Service over plain
// HTTPS — Expo relays to APNs / FCM, so the Worker never speaks raw APNs.
//
// All sends go through ctx.waitUntil so they never delay the API response, and
// every failure is swallowed: a push that doesn't go out must never turn a
// successful write (message sent, follow added) into an error for the client.

import { Env, query } from './db';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/** Send a push to every device token registered for `userId`. Fire-and-forget. */
export function sendPushToUser(
  env: Env,
  ctx: ExecutionContext,
  userId: string,
  msg: PushMessage,
): void {
  if (!userId) return;
  const task = (async () => {
    try {
      const rows = await query<{ token: string }>(
        env,
        `SELECT token FROM push_tokens WHERE user_id = ?`,
        [userId],
      );
      if (!rows.length) return;
      // Expo accepts up to 100 messages per request; a single user's device
      // count is far below that, so one request is always enough.
      const messages = rows.map((r) => ({
        to: r.token,
        title: msg.title,
        body: msg.body,
        sound: 'default',
        priority: 'high',
        channelId: 'default',
        data: msg.data ?? {},
      }));
      await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate',
        },
        body: JSON.stringify(messages),
      });
    } catch {
      // best-effort
    }
  })();
  ctx.waitUntil(task);
}
