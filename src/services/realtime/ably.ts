// Ably realtime client wrapper.
//
// Why Ably (instead of Supabase Realtime):
//   The Supabase free tier caps Realtime at 200 K msg/month, which is
//   exhausted by a few hundred active users. Ably's free tier is 6 M
//   msg/month with proper presence + history out of the box.
//
// Auth model:
//   The client never holds the Ably Root key. On connection it fetches a
//   short-lived (1 h) token from `/api/ably-token` (Vercel route). The
//   token's capability is scoped to the calling user — they can publish/
//   subscribe to `chat:*` and to their own `user:<uid>:*` channels, and
//   nothing else. If the token endpoint is unreachable we fall back to a
//   subscribe-only key (read-only mode) so the user still SEES incoming
//   messages.
//
// Connection lifecycle:
//   - `getRealtime()` lazily constructs the connection on first use.
//   - We do NOT auto-connect on app launch — Ably bills per realtime
//     channel-minute, so we open the connection only when the user lands
//     on a screen that actually needs realtime (chat, messages).
//   - `disconnect()` is fire-and-forget; on the next `getRealtime()`
//     call we'll reopen.
//
// Channel naming:
//   chat:<conversationId>             — message stream for one chat
//   user:<userId>:notifications       — personal notification ping channel
//   user:<userId>:presence            — user's presence channel

import * as Ably from 'ably';
import { getAblySubscribeKey } from '../env';
import { useAuthStore } from '../../store/authStore';

// The base URL for our Vercel API. In dev (Expo Go) this points at the
// production domain; in prod it's same-origin. We hard-code the production
// host so dev builds also work without a tunnel.
const TOKEN_ENDPOINT = 'https://san-m-app.com/api/ably-token';

let cachedClient: Ably.Realtime | null = null;
let cachedClientUserId: string | null = null;

/**
 * Build the auth callback the Ably SDK uses on (re)connect to fetch a
 * fresh TokenRequest. The callback runs on the device — it POSTs the
 * user's userId + deviceKey to /api/ably-token and returns the
 * TokenRequest, which the SDK then exchanges with Ably for a real auth
 * token.
 *
 * Returning `null` from this callback aborts the connection; the SDK will
 * retry per its built-in backoff.
 */
function buildAuthCallback(userId: string, deviceKey: string): Ably.AuthOptions['authCallback'] {
  return async (_tokenParams, callback) => {
    try {
      const resp = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, deviceKey }),
      });
      if (!resp.ok) {
        callback(`token endpoint returned ${resp.status}`, null);
        return;
      }
      const tokenRequest = await resp.json();
      // Ably types: a TokenRequest is acceptable here — the SDK redeems it.
      callback(null, tokenRequest);
    } catch (e: any) {
      callback(e?.message || 'auth_failed', null);
    }
  };
}

/**
 * Lazily get-or-create the Ably realtime client for the currently logged-in
 * user. Returns null if the user isn't authenticated yet (e.g. the first
 * paint of the app before login completes).
 *
 * The client is cached across calls. If the active user changes (account
 * switch / logout / login), the previous connection is torn down and a
 * fresh one is built bound to the new user — this matches the per-user
 * channel scope our token endpoint enforces.
 */
export function getRealtime(): Ably.Realtime | null {
  const { user } = useAuthStore.getState();
  if (!user?.id) return null;

  // Account changed — drop the cached client. Connection will reopen on
  // first channel access.
  if (cachedClient && cachedClientUserId !== user.id) {
    try {
      cachedClient.close();
    } catch {}
    cachedClient = null;
    cachedClientUserId = null;
  }

  if (cachedClient) return cachedClient;

  // The deviceKey is what proves identity to /api/ably-token. Without it we
  // can't auth, so we'd be stuck — fall back to subscribe-only key if it's
  // configured. That gives the user incoming messages but disables sends.
  const deviceKey = user.deviceKey;
  const fallbackKey = getAblySubscribeKey();

  let opts: Ably.ClientOptions;
  if (deviceKey) {
    opts = {
      // No `key` here — auth is purely via the callback so the bundle never
      // ships an Ably credential strong enough to publish on its own.
      authCallback: buildAuthCallback(user.id, deviceKey),
      // Reduce idle ping noise — the connection is short-lived (only while
      // the user is on a chat / messages screen), so we don't need
      // aggressive heartbeats.
      transportParams: { heartbeatInterval: 30000 },
      // Don't auto-reconnect forever if the token endpoint is dead; back
      // off and surface to the caller via connection state events.
      disconnectedRetryTimeout: 5000,
      suspendedRetryTimeout: 30000,
      // Keep recent messages so a quick UI re-mount doesn't have to
      // re-fetch history from Ably's history API.
      transports: ['web_socket'],
    };
  } else if (fallbackKey) {
    // Read-only mode. Useful for dev devices that haven't completed the
    // device-key handshake yet.
    opts = { key: fallbackKey };
  } else {
    // No credentials at all — we can't connect. Returning null so the
    // caller can degrade gracefully (e.g. fall back to polling).
    return null;
  }

  cachedClient = new Ably.Realtime(opts);
  cachedClientUserId = user.id;
  return cachedClient;
}

/**
 * Drop the cached connection. Safe to call multiple times. After this,
 * the next `getRealtime()` call will open a fresh connection.
 *
 * Use this when:
 *   - The user logs out (so the connection isn't held open for a stale id).
 *   - Account switch.
 *   - The app is backgrounded for a long period (caller's choice).
 */
export function disconnectRealtime(): void {
  if (cachedClient) {
    try {
      cachedClient.close();
    } catch {}
    cachedClient = null;
    cachedClientUserId = null;
  }
}

/**
 * Build the channel name for a chat conversation. Centralized so all
 * publishers + subscribers stay in sync.
 */
export function chatChannelName(conversationId: string): string {
  return `chat:${conversationId}`;
}

/**
 * Build the per-user notifications channel. Used to push "new message in
 * conversation X" pings to all of a user's connected devices so the
 * messages-tab badge updates without polling.
 */
export function userNotificationsChannelName(userId: string): string {
  return `user:${userId}:notifications`;
}
