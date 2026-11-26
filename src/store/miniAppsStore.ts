import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiDelete, apiGet, apiPatch, apiPost } from '../services/apiClient';
import { accountKey, getCacheAccount } from '../services/cacheService';
import { kvDeleteRaw, kvGetStringRawSync, kvSetStringRaw } from '../services/kvStore';
import { t } from '../i18n/store';

// ── THE LIST IS THERE IN THE FIRST FRAME, FOR THE RIGHT ACCOUNT ─────────────────────────────────
//
// Per-account storage: the base name ('mini-apps-cache') is wrapped in accountKey(), so each account
// keeps its own list. Answered from MMKV synchronously, like `syncPersistStorage`, so the store is
// hydrated inside `create()`: the Apps tab, search and San AI never draw an empty list while the copy
// on disk is read (it was AsyncStorage only, a native round trip after the store was created).
// AsyncStorage is still written, and read once (seeding MMKV) on the first launch after this change
// or wherever MMKV is missing.
//
// The key depends on the account the cache points at when the store is created, and that is only set
// in app/_layout.tsx after the first render. The store is normally created later (inline requires
// evaluate this module on first use), but nothing guarantees it, so `syncMiniAppsAccount` re-reads
// the list whenever it was read for another account.
let readFor: string | null = null;
const storage: StateStorage = {
  getItem: (name) => {
    const key = accountKey(name);
    readFor = getCacheAccount();
    const fast = kvGetStringRawSync(key);
    if (fast != null) return fast;
    return AsyncStorage.getItem(key).then((value) => {
      if (value != null) kvSetStringRaw(key, value);
      return value;
    });
  },
  setItem: (name, value) => {
    const key = accountKey(name);
    kvSetStringRaw(key, value);
    return AsyncStorage.setItem(key, value);
  },
  removeItem: (name) => {
    const key = accountKey(name);
    kvDeleteRaw(key);
    return AsyncStorage.removeItem(key);
  },
};

/**
 * How long a fetched list is trusted. The Apps tab, search, San AI and the settings screen each load
 * it when they open, so flipping between them asked the Worker for the same 50 rows every time.
 * Creating, editing and deleting update the list locally and do not wait for this.
 */
const APPS_FRESH_MS = 60_000;
let fetchedAt = 0;
let fetchedFor: string | null = null;

/** Same apps, same fields, same order. Both sides are the API's JSON (or its copy on disk). */
function sameApps(a: MiniApp[], b: MiniApp[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

export interface MiniApp {
  id: string;
  creator_id: string;
  name: string;
  description: string;
  emoji: string;
  url: string;
  created_at: string;
}

interface MiniAppsStore {
  apps: MiniApp[];
  isLoading: boolean;
  loadApps: () => Promise<void>;
  createApp: (app: Omit<MiniApp, 'id' | 'created_at'>) => Promise<{ error: string | null }>;
  updateApp: (
    id: string,
    updates: Partial<Pick<MiniApp, 'name' | 'emoji' | 'url' | 'description'>>,
  ) => Promise<{ error: string | null }>;
  deleteApp: (id: string) => Promise<void>;
  searchApps: (query: string) => MiniApp[];
}

export const useMiniAppsStore = create<MiniAppsStore>()(
  persist(
    (set, get) => ({
      apps: [],
      isLoading: false,

      loadApps: async () => {
        const account = getCacheAccount();
        if (fetchedFor === account && Date.now() - fetchedAt < APPS_FRESH_MS) return;
        // `isLoading` only means something while there is nothing to show (the settings screen's
        // spinner). Every `set` here is also a write of the whole list to storage.
        if (get().apps.length === 0) set({ isLoading: true });
        try {
          const { data } = await apiGet<MiniApp[]>('/v1/mini-apps?limit=50');
          if (Array.isArray(data)) {
            fetchedAt = Date.now();
            fetchedFor = account;
            // An unchanged list keeps the array on screen, so nothing that reads it re-renders.
            if (!sameApps(get().apps, data)) set({ apps: data });
          }
        } catch {}
        if (get().isLoading) set({ isLoading: false });
      },

      createApp: async (app) => {
        try {
          const { data, error } = await apiPost<MiniApp & { profiles?: unknown }>(
            '/v1/mini-apps',
            {
              name: app.name,
              description: app.description,
              emoji: app.emoji,
              url: app.url,
            },
          );
          if (error) return { error };
          if (data) {
            const next: MiniApp = {
              id: data.id,
              creator_id: data.creator_id,
              name: data.name,
              description: data.description,
              emoji: data.emoji,
              url: data.url,
              created_at: data.created_at,
            };
            set((s) => ({ apps: [next, ...s.apps] }));
          }
          return { error: null };
        } catch (e: any) {
          return { error: e?.message || t('common.error') };
        }
      },

      updateApp: async (id, updates) => {
        try {
          const { data, error } = await apiPatch<MiniApp>(`/v1/mini-apps/${encodeURIComponent(id)}`, updates);
          if (error) return { error };
          // Local-first merge — even if the Worker didn't echo a row
          // back (rare), we still apply the patch to the cached entry.
          set((s) => ({
            apps: s.apps.map((a) =>
              a.id === id
                ? {
                    ...a,
                    ...(data
                      ? {
                          name: data.name,
                          description: data.description,
                          emoji: data.emoji,
                          url: data.url,
                        }
                      : updates),
                  }
                : a,
            ),
          }));
          return { error: null };
        } catch (e: any) {
          return { error: e?.message || t('common.error') };
        }
      },

      deleteApp: async (id) => {
        try {
          await apiDelete(`/v1/mini-apps/${encodeURIComponent(id)}`);
        } catch {}
        set((s) => ({ apps: s.apps.filter(a => a.id !== id) }));
        // Reference `get` so the linter/treeshaker keeps the binding —
        // it's part of the persist API contract even when unused here.
        void get;
      },

      searchApps: (query) => {
        const lower = query.toLowerCase();
        return get().apps.filter(a =>
          a.name.toLowerCase().includes(lower) ||
          a.description.toLowerCase().includes(lower)
        );
      },
    }),
    {
      name: 'mini-apps-cache',
      storage: createJSONStorage(() => storage),
      partialize: (state) => ({ apps: state.apps }),
      // An account with nothing stored gets an empty list, not the previous account's (see
      // `syncMiniAppsAccount`). On the first read the list is empty either way.
      merge: (persisted, current) => {
        const apps = (persisted as Partial<MiniAppsStore> | undefined)?.apps;
        return { ...current, apps: Array.isArray(apps) ? apps : [] };
      },
    }
  )
);

/**
 * Re-read the stored list when it was read for another account than the one the cache points at now.
 * Call right after `setCacheAccount`. A no-op in the usual case, where the store was created after it.
 */
export function syncMiniAppsAccount(): void {
  const account = getCacheAccount();
  if (readFor === null || readFor === account) return;
  try { void useMiniAppsStore.persist.rehydrate(); } catch {}
}
