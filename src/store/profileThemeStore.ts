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

// Per-account map helpers. `byAccount` is a NULL-PROTOTYPE object so an account
// id that happens to equal a reserved key ("__proto__", "constructor", …) is
// stored and read as ordinary data instead of colliding with Object.prototype.
// Real account ids are UUIDs, but the per-account isolation invariant (Req 9.5,
// Property 11) must hold for ANY string key. Note: assigning a plain string to a
// computed `["__proto__"]` key on a normal object is silently dropped by the
// prototype setter after Babel transpilation, which is exactly the bug this
// avoids.
function emptyAccounts(): Record<string, string> {
  return Object.create(null) as Record<string, string>;
}
function cloneAccounts(map: Record<string, string>): Record<string, string> {
  return Object.assign(Object.create(null), map) as Record<string, string>;
}
function hasAccount(map: Record<string, string>, accountId: string): boolean {
  return Object.prototype.hasOwnProperty.call(map, accountId);
}

export interface ProfileThemeState {
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
  byAccount: emptyAccounts(),

  getThemeId: (accountId) => {
    if (!accountId) return undefined;
    const map = get().byAccount;
    // Own-property check so a reserved key never resolves to an inherited
    // Object.prototype member (e.g. `map["__proto__"]`).
    const inMem = hasAccount(map, accountId) ? map[accountId] : undefined;
    if (inMem !== undefined) return inMem;
    // Pure read — no state mutation, safe to call during render. The reactive
    // hook below hydrates the map via `hydrateFromStorage` in an effect.
    return readPersisted(accountId);
  },

  setThemeId: (accountId, themeId) => {
    if (!accountId) return;
    set((s) => {
      const next = cloneAccounts(s.byAccount);
      next[accountId] = themeId;
      return { byAccount: next };
    });
    kvSetStringRaw(persistKey(accountId), themeId);
  },

  revertThemeId: (accountId, prev) => {
    if (!accountId) return;
    if (prev === undefined) {
      set((s) => {
        if (!hasAccount(s.byAccount, accountId)) return s;
        const next = cloneAccounts(s.byAccount);
        delete next[accountId];
        return { byAccount: next };
      });
      kvDeleteRaw(persistKey(accountId));
      return;
    }
    set((s) => {
      const next = cloneAccounts(s.byAccount);
      next[accountId] = prev;
      return { byAccount: next };
    });
    kvSetStringRaw(persistKey(accountId), prev);
  },

  hydrateFromStorage: (accountId) => {
    if (!accountId) return;
    set((s) => {
      if (hasAccount(s.byAccount, accountId) && s.byAccount[accountId] !== undefined) return s;
      const persisted = readPersisted(accountId);
      if (persisted === undefined) return s;
      const next = cloneAccounts(s.byAccount);
      next[accountId] = persisted;
      return { byAccount: next };
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
