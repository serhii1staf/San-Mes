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

// Base64 decode that tolerates the Worker runtime (atob is available globally
// on Cloudflare Workers). Returns '' on any malformed input.
function b64decode(s: string): string {
  try {
    // eslint-disable-next-line no-undef
    return typeof atob === 'function' ? decodeURIComponent(escape(atob(s))) : '';
  } catch {
    return '';
  }
}

// Turn raw stored content into a human-readable push/notification preview.
//
// Storage markers we must never leak into a notification body:
//   ::re::<base64(JSON{u,sn,gif})>::<body>   reply comment (current format)
//   ::re:<b64>:<b64>[:<b64>]::<body>         reply comment (legacy format)
//   ::gif::<url>                             GIF-only comment/message
//   ::repost::<postId>::<comment>            repost post
//
// IMPORTANT: always operate on the FULL content, never a pre-sliced prefix —
// slicing first can cut the closing "::" terminator and leak the raw base64
// blob (this was the "::re::eyJ1..." bug in the notifications screen).
export function cleanPushBody(raw: string): string {
  if (!raw) return '';
  let s = raw;

  if (s.startsWith('::re::')) {
    const idx = s.indexOf('::', 6);
    const blob = idx > 0 ? s.slice(6, idx) : '';
    const body = idx > 0 ? s.slice(idx + 2).trim() : '';
    if (body) { s = body; }
    else {
      // No typed body — surface what the reply quoted (gif → "GIF").
      let gif = '';
      try { gif = (JSON.parse(b64decode(blob)) || {}).gif || ''; } catch { /* noop */ }
      return gif ? 'GIF' : 'Reply';
    }
  } else if (s.startsWith('::re:')) {
    const idx = s.indexOf('::', 5);
    const body = idx > 0 ? s.slice(idx + 2).trim() : '';
    if (!body) return 'Reply';
    s = body;
  } else if (s.startsWith('::repost::')) {
    const idx = s.indexOf('::', 10);
    s = idx > 0 ? s.slice(idx + 2).trim() : '';
  }

  if (s.startsWith('::gif::')) return 'GIF';

  // A body that is nothing but a media/link URL becomes a generic label.
  const trimmed = s.trim();
  if (/^https?:\/\/\S+$/i.test(trimmed)) {
    const u = trimmed.toLowerCase();
    if (/\.gif(\?|$)/.test(u) || u.includes('giphy.com') || u.includes('tenor.com')) return 'GIF';
    if (/\.(jpg|jpeg|png|webp|heic|heif)(\?|$)/.test(u)) return 'Photo';
    return 'Link';
  }

  // Safety net: anything still leading with a "::" marker we don't recognise
  // must not leak — collapse to empty.
  if (trimmed.startsWith('::')) return '';
  return trimmed;
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
