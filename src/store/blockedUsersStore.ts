// Blocked-users store — the per-account list of user IDs the viewer has
// blocked. Distinct from `chatSettingsStore.blocked` which is keyed by
// chatId (a chat-level mute). This store is keyed by author/profile id and
// drives content hiding across feed, profile lists, comments, and the
// Blocked section in the messages tab.
//
// Persistence: per-account MMKV via the existing `kvStore` namespace
// (see `services/cacheAccount.ts` — every key is automatically prefixed
// with `@acc:${activeAccountId}:`). Switching accounts via
// `services/accountSwitch.ts` rescopes the storage namespace to the new
// account, so the next read of this store's MMKV key returns that
// account's own block list, not the previous one's.
//
// Server persistence: the Supabase schema currently has no
// `blocked_users` table (see `supabase-migration.sql`). We deliberately
// keep this store local-only — the block is a CLIENT-SIDE filter that
// hides content from the viewer; we are NOT implementing server-side
// moderation here. If/when a `blocked_users` table is added, wire
// `block` / `unblock` below to upsert/delete a row keyed by
// `(blocker_id, blocked_id)` and hydrate from that table on login.

import { create } from 'zustand';
import { kvGetJSONSync, kvSetJSON } from '../services/kvStore';

const KV_KEY = '@san:blocked_users';

interface BlockedUsersState {
  /** Set of blocked user IDs (kept as an array for cheap stable subscription). */
  ids: string[];

  // ─── Mutations ────────────────────────────────────────────────────────
  block: (userId: string) => void;
  unblock: (userId: string) => void;

  // ─── Reads ────────────────────────────────────────────────────────────
  isBlocked: (userId: string | null | undefined) => boolean;

  // ─── Bookkeeping ──────────────────────────────────────────────────────
  /**
   * Re-hydrate from the active account's MMKV namespace. Must be called
   * after `setCacheAccount(...)` switches the namespace pointer (e.g. on
   * app start once auth resolves, and again from `accountSwitch`).
   */
  hydrate: () => void;
  /**
   * Drop in-memory state. Used by the account switcher right before
   * `hydrate()` so a stale list never bleeds across accounts.
   */
  reset: () => void;
}

function persist(ids: string[]): void {
  // Fire-and-forget — kvSetJSON is synchronous on MMKV and best-effort on
  // the AsyncStorage fallback. We never want a write failure to bubble
  // up into the optimistic UI flip.
  try {
    kvSetJSON(KV_KEY, ids);
  } catch {
    // ignore
  }
}

function readInitial(): string[] {
  try {
    return kvGetJSONSync<string[]>(KV_KEY, []);
  } catch {
    return [];
  }
}

export const useBlockedUsersStore = create<BlockedUsersState>((set, get) => ({
  ids: readInitial(),
  block: (userId) => {
    if (!userId) return;
    const prev = get().ids;
    if (prev.includes(userId)) return;
    const next = [...prev, userId];
    set({ ids: next });
    persist(next);
  },
  unblock: (userId) => {
    if (!userId) return;
    const prev = get().ids;
    if (!prev.includes(userId)) return;
    const next = prev.filter((id) => id !== userId);
    set({ ids: next });
    persist(next);
  },
  isBlocked: (userId) => {
    if (!userId) return false;
    return get().ids.includes(userId);
  },
  hydrate: () => {
    set({ ids: readInitial() });
  },
  reset: () => {
    set({ ids: [] });
  },
}));

/**
 * Stable selector — returns the array reference. Components that only
 * need to know whether ONE id is blocked should use `useIsBlocked` below
 * instead, so they don't re-render on every block-list mutation.
 */
export const selectBlockedIds = (s: BlockedUsersState) => s.ids;

/**
 * Hook returning whether `userId` is currently blocked. Subscribes only
 * to the boolean derivation so feed cards and comment rows don't
 * re-render every time some unrelated user is blocked / unblocked.
 */
export function useIsBlocked(userId: string | null | undefined): boolean {
  return useBlockedUsersStore((s) => (userId ? s.ids.includes(userId) : false));
}
