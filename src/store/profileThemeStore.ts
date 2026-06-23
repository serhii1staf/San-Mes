import { useEffect } from 'react';
import { create } from 'zustand';
import { kvGetStringRawSync, kvSetStringRaw, kvDeleteRaw } from '../services/kvStore';
import type { ProfileThemeId } from '../theme/profileThemes';

/**
 * profileThemeStore — thin per-account mirror of the owner's selected Theme_Id.
 *
 * Theme_Id is authoritative on the backend profile row (alongside `banner_url`),
 * so this store only holds the per-account optimistic/persisted mirror used by
 * the Theme_Selection_Screen and the owner's own profile before a server
 * round-trip settles (design §"Components and Interfaces #7").
 *
 * Per-account isolation (Req 9.5): state is keyed by `accountId`, and durable
 * persistence uses the same `@acc:${accountId}:` namespacing as every other
 * per-account cache (see `cacheAccount.accountKey`). Because each account is
 * written to its own MMKV key, updating one account's Theme_Id leaves every
 * other account's stored value byte-identical. Resolution of a stored id to a
 * renderable theme is always done via `resolveProfileTheme`.
 */

// Base storage key; namespaced per account below. Mirrors the `accountKey()`
// shape (`@acc:${id}:${base}`) but parameterized by an explicit accountId so a
// non-active account is never written under the wrong namespace.
const THEME_ID_BASE = 'profile_theme_id';

function persistKey(accountId: string): string {
  return `@acc:${accountId}:${THEME_ID_BASE}`;
}

function readPersisted(accountId: string): string | undefined {
  const raw = kvGetStringRawSync(persistKey(accountId));
  return raw == null ? undefined : raw;
}

interface ProfileThemeState {
  /** accountId → last-known Theme_Id mirror. */
  byAccount: Record<string, string>;
  /** Read the stored Theme_Id for an account (in-memory, falling back to MMKV). */
  getThemeId: (accountId: string) => string | undefined;
  /** Optimistically set / commit an account's Theme_Id. Only that entry changes. */
  setThemeId: (accountId: string, themeId: string) => void;
  /** Restore a previous value; deletes the entry when `prev` is undefined. */
  revertThemeId: (accountId: string, prev: string | undefined) => void;
  /** Load a persisted value into the reactive map if not already present. */
  hydrateFromStorage: (accountId: string) => void;
}

export const useProfileThemeStore = create<ProfileThemeState>((set, get) => ({
  byAccount: {},

  getThemeId: (accountId) => {
    if (!accountId) return undefined;
    const inMem = get().byAccount[accountId];
    if (inMem !== undefined) return inMem;
    // Pure read — no state mutation, safe to call during render. The reactive
    // hook below hydrates the map via `hydrateFromStorage` in an effect.
    return readPersisted(accountId);
  },

  setThemeId: (accountId, themeId) => {
    if (!accountId) return;
    set((s) => ({ byAccount: { ...s.byAccount, [accountId]: themeId } }));
    kvSetStringRaw(persistKey(accountId), themeId);
  },

  revertThemeId: (accountId, prev) => {
    if (!accountId) return;
    if (prev === undefined) {
      set((s) => {
        if (!(accountId in s.byAccount)) return s;
        const next = { ...s.byAccount };
        delete next[accountId];
        return { byAccount: next };
      });
      kvDeleteRaw(persistKey(accountId));
      return;
    }
    set((s) => ({ byAccount: { ...s.byAccount, [accountId]: prev } }));
    kvSetStringRaw(persistKey(accountId), prev);
  },

  hydrateFromStorage: (accountId) => {
    if (!accountId) return;
    set((s) => {
      if (s.byAccount[accountId] !== undefined) return s;
      const persisted = readPersisted(accountId);
      if (persisted === undefined) return s;
      return { byAccount: { ...s.byAccount, [accountId]: persisted } };
    });
  },
}));

/**
 * useActiveProfileThemeId — reactive per-account selector returning the stored
 * Theme_Id for `accountId` (or `undefined` when none is set). Hydrates the
 * persisted MMKV value into the store on first use so the value stays reactive.
 * The raw id is returned as-is; callers resolve it via `resolveProfileTheme`.
 */
export function useActiveProfileThemeId(accountId: string): string | undefined {
  const stored = useProfileThemeStore((s) =>
    accountId ? s.byAccount[accountId] : undefined
  );

  useEffect(() => {
    if (!accountId) return;
    useProfileThemeStore.getState().hydrateFromStorage(accountId);
  }, [accountId]);

  return stored;
}

// Re-export for convenience so consumers can type-narrow stored ids.
export type { ProfileThemeId };
