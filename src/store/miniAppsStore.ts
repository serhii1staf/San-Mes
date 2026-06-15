import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiDelete, apiGet, apiPatch, apiPost } from '../services/apiClient';
import { accountKey } from '../services/cacheService';
import { t } from '../i18n/store';

// Per-account persist storage: the base name ('mini-apps-cache') is wrapped in
// accountKey() so each account keeps its own mini-apps list namespace.
const storage: StateStorage = {
  setItem: async (name, value) => { await AsyncStorage.setItem(accountKey(name), value); },
  getItem: async (name) => { return await AsyncStorage.getItem(accountKey(name)); },
  removeItem: async (name) => { await AsyncStorage.removeItem(accountKey(name)); },
};

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
        set({ isLoading: true });
        try {
          const { data } = await apiGet<MiniApp[]>('/v1/mini-apps?limit=50');
          if (data) set({ apps: data });
        } catch {}
        set({ isLoading: false });
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
    }
  )
);
