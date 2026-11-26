// Abuse guards shared by the write routes: blocks between two people, and rate limits.
//
// ── BLOCKS WERE ONLY ENFORCED ON THE CLIENT (Nov 2026) ───────────────────────────────────────────
//
// `blocked_users` was written by POST /v1/blocks and read by GET /v1/blocks, and by nothing else. A
// blocked person could keep messaging the one who blocked them, and every message still went out as
// a push, which the OS shows on the lock screen before the app can filter anything; they could keep
// commenting on that person's posts too, which also pushes. App Review 1.2 requires blocking to work.
// The routes that reach another person now ask `blockedBetween` first and answer 403 'forbidden', the
// string the client's offline queue already treats as final (offlineQueue.ts, `classifyError`), so a
// refused send is not retried forever.
//
// ── RATE LIMITS (Nov 2026) ───────────────────────────────────────────────────────────────────────
//
// No route had any. User ids are public, a conversation can be opened with anyone, and every message
// is a push and a realtime publish, so one script could flood a person's lock screen and burn the
// project's Ably and Expo quotas for everyone; the login (device key + PIN) could be walked through
// 0000-9999 in minutes. The limits use Cloudflare's Workers rate-limiting bindings (wrangler.toml,
// `[[ratelimits]]`): counted per location, in 10 or 60 s windows, approximate by design, which is
// right for bursts and abuse. The numbers are far above what the app does on its own (a chat polls
// its history about ten times a minute while open). A missing binding (tests, local dev) or a
// failing limiter lets the request through: availability first.

import type { Env } from './db';
import { queryOne } from './db';

/** True when either person has blocked the other. False when the table does not exist yet. */
export async function blockedBetween(env: Env, a: string, b: string): Promise<boolean> {
  if (!a || !b || a === b) return false;
  try {
    const row = await queryOne<{ x: number }>(
      env,
      `SELECT 1 AS x FROM blocked_users
        WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)
        LIMIT 1`,
      [a, b, b, a],
    );
    return !!row;
  } catch {
    // `blocked_users` is created by migration 0004 and lazily by routes/reports.ts. A database that
    // has neither has no blocks to enforce.
    return false;
  }
}

/** True when `blocker` has blocked `blocked` (one direction). */
export async function hasBlocked(env: Env, blocker: string, blocked: string): Promise<boolean> {
  if (!blocker || !blocked || blocker === blocked) return false;
  try {
    const row = await queryOne<{ x: number }>(
      env,
      `SELECT 1 AS x FROM blocked_users WHERE blocker_id = ? AND blocked_id = ? LIMIT 1`,
      [blocker, blocked],
    );
    return !!row;
  } catch {
    return false;
  }
}

/** The other participant of a 1:1 conversation, or null. */
export async function otherParticipant(env: Env, conversationId: string, userId: string): Promise<string | null> {
  const row = await queryOne<{ user_id: string }>(
    env,
    `SELECT user_id FROM conversation_participants WHERE conversation_id = ? AND user_id != ? LIMIT 1`,
    [conversationId, userId],
  );
  return row?.user_id ?? null;
}

// ── Rate limits ─────────────────────────────────────────────────────────────────────────────────

/** The binding names in wrangler.toml. */
export type RateClass = 'AUTH' | 'SIGNUP' | 'READ' | 'WRITE' | 'HEAVY' | 'PUSH';

interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

function limiter(env: Env, cls: RateClass): RateLimiter | null {
  const binding = (env as unknown as Record<string, unknown>)[`RL_${cls}`];
  if (binding && typeof (binding as RateLimiter).limit === 'function') return binding as RateLimiter;
  return null;
}

/** Whether `key` is still within its class's limit. True when the class has no binding or fails. */
export async function withinLimit(env: Env, cls: RateClass, key: string): Promise<boolean> {
  const rl = limiter(env, cls);
  if (!rl) return true;
  try {
    const { success } = await rl.limit({ key });
    return success;
  } catch {
    return true;
  }
}

/** The caller's address, for the limits on requests made before signing in. */
export function clientIp(req: Request): string {
  return req.headers.get('CF-Connecting-IP') || req.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() || 'unknown';
}

/**
 * The class a request is limited by, from its method and path. Sign-in and sign-up are limited per
 * address (there is no account yet); everything else per account, or per address when anonymous.
 */
export function rateClassFor(method: string, path: string): RateClass {
  if (method === 'POST' && path === '/v1/auth/register') return 'SIGNUP';
  if (method === 'POST' && path === '/v1/auth/login') return 'AUTH';
  if (method === 'GET' && path.startsWith('/v1/profiles/by-device-key/')) return 'AUTH';
  // A sticker-pack import makes up to ~120 calls to Telegram's API per request.
  if (method === 'GET' && path === '/v1/stickers/telegram') return 'HEAVY';
  if (method === 'GET' || method === 'HEAD') return 'READ';
  // A new conversation, post, repost, report or sticker import: rare in normal use, costly to abuse.
  // And a San AI request, which spends the account's NVIDIA quota (routes/ai.ts).
  if (method === 'POST' && (
    path === '/v1/conversations' ||
    path === '/v1/posts' ||
    path === '/v1/posts/repost' ||
    path === '/v1/reports' ||
    path === '/v1/mini-apps' ||
    path === '/v1/ai/complete' ||
    path === '/v1/ai/transcribe' ||
    path === '/v1/ai/transcribe/warm'
  )) return 'HEAVY';
  return 'WRITE';
}
