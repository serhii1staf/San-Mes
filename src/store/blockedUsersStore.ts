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
   * Pull the server's authoritative block list and MERGE it into the
   * local set (union — never drops a locally-blocked id the server
   * hasn't confirmed yet). Complementary to the local `hydrate()`:
   * call it after auth resolves so blocks made on another device show
   * up here, while a just-made local block that hasn't reached the
   * server is preserved. Guarded — best-effort, never throws.
   */
  hydrateFromServer: () => Promise<void>;
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
    // Mirror to the server (best-effort). Lazy-imported to avoid an
    // import cycle (moderation → apiClient is fine, but keep this
    // store free of eager service deps) and fire-and-forget so the
    // optimistic UI flip never waits on the network.
    import('../services/moderation')
      .then((m) => m.blockUserRemote(userId))
      .catch(() => {});
  },
  unblock: (userId) => {
    if (!userId) return;
    const prev = get().ids;
    if (!prev.includes(userId)) return;
    const next = prev.filter((id) => id !== userId);
    set({ ids: next });
    persist(next);
    // Mirror to the server (best-effort), lazy + fire-and-forget.
    import('../services/moderation')
      .then((m) => m.unblockUserRemote(userId))
      .catch(() => {});
  },
  isBlocked: (userId) => {
    if (!userId) return false;
    return get().ids.includes(userId);
  },
  hydrate: () => {
    set({ ids: readInitial() });
  },
  hydrateFromServer: async () => {
    try {
      const { fetchBlockedIds } = await import('../services/moderation');
      const serverIds = await fetchBlockedIds();
      if (!serverIds.length) return;
      const prev = get().ids;
      // Union — keep every locally-blocked id (the server may not have
      // confirmed a just-made block yet) and add any the server knows
      // about that we don't.
      const merged = [...prev];
      for (const id of serverIds) {
        if (id && !merged.includes(id)) merged.push(id);
      }
      if (merged.length !== prev.length) {
        set({ ids: merged });
        persist(merged);
      }
    } catch {
      // best-effort — local state stands.
    }
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
