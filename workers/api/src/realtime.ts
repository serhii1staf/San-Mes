// Ably REST publishing.
//
// Each Worker mutation calls `publishEvent(...)` after a successful
// write. We HTTP-POST to Ably's REST endpoint with the root key
// (Worker secret) — that's strictly server-side, the client never
// sees this token.
//
// Requirements:
//   - Fire-and-forget: never block the response on this call.
//   - Bounded budget: 2-second timeout. If Ably is down, the write
//     still returns 200; the realtime fan-out simply doesn't happen.
//   - Compact payloads: events ride the WebSocket frame budget; we
//     send DELTAS, not full row copies.
//
// Cost (Ably free tier: 6M messages/month):
//   - Each event = 1 message. A user posting 100 things/day = 100 msgs.
//   - A 1000-active-user app generates ~30K events/day = 900K/month.
//   - Fits free tier with 6× headroom.

import type { Env } from './db';

interface PublishOptions {
  /** Wait for Ably's response (default false: fire-and-forget). */
  wait?: boolean;
  /** Timeout in ms (default 2000). */
  timeoutMs?: number;
}

/**
 * Publish a single event to an Ably channel via the REST API. Always
 * returns void — by design, the call never throws so route handlers
 * can layer it after a D1 write without try/catch boilerplate. When
 * `ctx` is supplied (the standard path), the publish is registered
 * with `ctx.waitUntil(...)` so the response goes back to the caller
 * before Ably finishes processing.
 */
export async function publishEvent(
  env: Env,
  channel: string,
  name: string,
  data: unknown,
  ctx?: ExecutionContext,
  opts: PublishOptions = {},
): Promise<void> {
  if (!env.ABLY_ROOT_KEY) return; // Realtime disabled if secret missing
  const url = `https://rest.ably.io/channels/${encodeURIComponent(channel)}/messages`;
  const body = JSON.stringify({ name, data });
  const auth = 'Basic ' + btoa(env.ABLY_ROOT_KEY);

  const promise = (async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 2000);
    try {
      await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': auth,
          'Content-Type': 'application/json',
        },
        body,
        signal: ctrl.signal,
      });
    } catch {
      // Realtime is best-effort. The persisted write already succeeded;
      // missing realtime doesn't break the app, just delays peers seeing
      // the change until their next refresh.
    } finally {
      clearTimeout(timer);
    }
  })();

  if (opts.wait) {
    await promise;
  } else if (ctx) {
    // Workers' `waitUntil` lets the publish finish AFTER we return the
    // response — the user sees the success immediately, the fan-out
    // continues in the background.
    ctx.waitUntil(promise);
  }
  // No ctx + no wait: detach with no waitUntil; the request handler
  // returns and the runtime may kill the publish mid-flight. Endpoints
  // that need the publish to complete reliably MUST pass `ctx`.
}

/** Channel-name builders so typos can't reach a route handler. */
export const channels = {
  feedPublic: () => 'feed:public',
  post: (postId: string) => `post:${postId}`,
  userNotifications: (userId: string) => `user:${userId}:notifications`,
  userProfile: (userId: string) => `user:${userId}:profile`,
  userFollows: (userId: string) => `user:${userId}:follows`,
};
