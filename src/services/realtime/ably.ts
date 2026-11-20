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
import { getAuthToken } from '../authClient';
import { useAuthStore } from '../../store/authStore';

// The base URL for our Vercel API. In dev (Expo Go) this points at the
// production domain; in prod it's same-origin. We hard-code the production
// host so dev builds also work without a tunnel.
const TOKEN_ENDPOINT = 'https://san-m-app.com/api/ably-token';

/**
 * Token-fetch timeout. Must be well under the SDK's own retry cadence so a failure
 * surfaces as an error the SDK can back off from, rather than as a callback that is
 * never invoked (see the note at the call site).
 */
const TOKEN_TIMEOUT_MS = 10000;

let cachedClient: Ably.Realtime | null = null;
let cachedClientUserId: string | null = null;

/**
 * The previous connection's Ably token, kept across a background disconnect.
 *
 * `RealtimeAccountBridge` closes the connection after 10 s in the background, and the next client
 * then minted a new token: one request to `/api/ably-token`, which in turn asks the Worker
 * (`/v1/auth/me`) who the caller is. That was a Worker request on almost every return to the app,
 * for a token that still had most of its hour left. The new client now starts from the old token and
 * only calls the auth callback when Ably says it has expired.
 *
 * Bound to the user AND the Worker session it was minted under, so a logout, an account switch or a
 * re-login can never connect with a token from before.
 */
let parkedToken: { userId: string; session: string; details: Ably.TokenDetails } | null = null;
/** A parked token this close to expiry is not worth reusing. */
const PARKED_TOKEN_MIN_LEFT_MS = 2 * 60 * 1000;

/**
 * Build the auth callback the Ably SDK uses on (re)connect to fetch a
 * fresh TokenRequest.
 *
 * SECURITY: identity is proven with the Worker-issued JWT, sent as a normal bearer
 * header. It used to be proven by POSTing `{ userId, deviceKey }`, i.e. by presenting
 * the device key as a bearer credential. That was unsafe for two reasons: the device
 * key is long-lived and never rotates, and (until this change) it was readable from
 * unauthenticated profile endpoints — so anyone could mint a realtime token for any
 * user. A JWT expires, is scoped by the issuer, and is the credential the rest of
 * the API already uses.
 *
 * The token is read at call time (not captured) so the SDK's own re-auth on token
 * expiry picks up a refreshed one.
 *
 * Returning an error from this callback aborts the connection; the SDK will retry
 * per its built-in backoff.
 */
function buildAuthCallback(): Ably.AuthOptions['authCallback'] {
  return async (_tokenParams, callback) => {
    try {
      const token = getAuthToken();
      if (!token) {
        callback('not_signed_in', null);
        return;
      }
      // ── Timeout ────────────────────────────────────────────────────────────
      // This fetch had no timeout, and the consequence was subtle: the Ably SDK
      // waits for `callback` to be invoked, so a request that never resolves means
      // the callback is never called, which means the SDK's OWN retry
      // (`disconnectedRetryTimeout`) never arms. Realtime then stays silently dead
      // for the whole session with no error anywhere — no new messages, no
      // presence, and nothing to indicate why. A captive portal is enough to
      // trigger it.
      const controller = new AbortController();
      const abortTimer = setTimeout(() => controller.abort(), TOKEN_TIMEOUT_MS);
      let resp: Response;
      try {
        resp = await fetch(TOKEN_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          // Body kept as an empty object: the endpoint derives the user id from the
          // verified token, never from anything the client asserts about itself.
          body: '{}',
          signal: controller.signal,
        });
      } finally {
        clearTimeout(abortTimer);
      }
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
 * Whether this user's realtime connection exists and is connected. Unlike `getRealtime`, never
 * creates a client: for code that only wants to know whether live delivery is working right now.
 */
export function isRealtimeConnected(): boolean {
  const uid = useAuthStore.getState().user?.id;
  return !!uid && !!cachedClient && cachedClientUserId === uid && cachedClient.connection.state === 'connected';
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

  // The Worker JWT is what proves identity to /api/ably-token. Without one we
  // can't auth, so we'd be stuck — fall back to the subscribe-only key if it's
  // configured. That gives the user incoming messages but disables sends.
  const haveToken = !!getAuthToken();
  const fallbackKey = getAblySubscribeKey();

  let opts: Ably.ClientOptions;
  if (haveToken) {
    // Resume with the token from the previous connection when it is this user's, from this session,
    // and not about to expire. See `parkedToken`.
    const parked = parkedToken;
    parkedToken = null;
    const reuse =
      parked &&
      parked.userId === user.id &&
      parked.session === getAuthToken() &&
      (!parked.details.expires || parked.details.expires - Date.now() > PARKED_TOKEN_MIN_LEFT_MS)
        ? parked.details
        : undefined;
    opts = {
      // No `key` here — auth is purely via the callback so the bundle never
      // ships an Ably credential strong enough to publish on its own.
      authCallback: buildAuthCallback(),
      // Still renewed through the callback above when Ably reports it expired.
      ...(reuse ? { tokenDetails: reuse } : {}),
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
      // ── DO NOT DELIVER THIS CONNECTION'S OWN PUBLISHES BACK TO IT ─────────────
      //
      // Ably's default is to echo every message a connection publishes back to that same
      // connection. Everything this client publishes (chat `msg` / `msg.edit` / `msg.delete`,
      // typing every two seconds while typing) is already dropped on receipt by sender id, in
      // the chat screen and in `useTypingPeers`, so the echo was inbound traffic, a JSON parse
      // and a listener dispatch for nothing, and each one counted against the account's Ably
      // message quota. Only this connection is affected: the same account on another device
      // still receives everything, and messages the Worker publishes (`notif.message`,
      // `post:*`, `post:author:*`) come from the Worker's own connection and are unaffected.
      echoMessages: false,
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
    // Keep the token for the next connection; see `parkedToken`. `auth.tokenDetails` is the SDK's
    // own cache of the token it is using (not in the public typings, hence the cast).
    try {
      const details = (cachedClient as any).auth?.tokenDetails as Ably.TokenDetails | null | undefined;
      const session = getAuthToken();
      parkedToken =
        details && details.token && cachedClientUserId && session
          ? { userId: cachedClientUserId, session, details }
          : null;
    } catch {
      parkedToken = null;
    }
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

/**
 * Per-user profile-edits channel. The Worker publishes to this from
 * `PATCH /v1/profiles/me` so every other device the user is signed in
 * on applies the bio / display name / banner change instantly.
 */
export function userProfileChannelName(userId: string): string {
  return `user:${userId}:profile`;
}

/**
 * Per-user follow-graph channel. Published to by the Worker on follow /
 * unfollow — both for the followed user (incoming events
 * `follow.added` / `follow.removed`) and for the actor (outgoing events
 * `follow.outgoing.added` / `follow.outgoing.removed`) so multi-device
 * sessions stay in sync.
 */
export function userFollowsChannelName(userId: string): string {
  return `user:${userId}:follows`;
}

/**
 * Per-post events channel. Carries `comment.new`, `comment.edit`,
 * `comment.delete`, `post.like`, `post.unlike`, `post.edit`,
 * `post.delete`, `post.repost`. Subscribed by the comments screen and
 * any other place that hosts live post state.
 */
export function postChannelName(postId: string): string {
  return `post:${postId}`;
}

/**
 * Public feed firehose. Every new post (including reposts), every edit,
 * every delete fans out here. The bridge subscribes lazily so the home
 * tab gets fresh content without a refetch — and unsubscribes when the
 * user signs out.
 */
export function feedPublicChannelName(): string {
  return 'feed:public';
}

/**
 * One person's posts and profile edits, for whoever has their profile open. Published only by the
 * Worker (`channels.author` in workers/api/src/realtime.ts; must match), subscribe-only for the app
 * through the `post:*` capability. See src/services/realtime/authorChannel.ts.
 */
export function authorChannelName(userId: string): string {
  return `post:author:${userId}`;
}
