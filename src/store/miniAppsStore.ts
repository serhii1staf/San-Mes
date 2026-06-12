import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
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
          const { data } = await supabase
            .from('mini_apps')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(50);
          if (data) set({ apps: data });
        } catch {}
        set({ isLoading: false });
      },

      createApp: async (app) => {
        try {
          const { data, error } = await supabase
            .from('mini_apps')
            .insert(app)
            .select()
            .single();
          if (error) return { error: error.message };
          if (data) set((s) => ({ apps: [data, ...s.apps] }));
          return { error: null };
        } catch (e: any) {
          return { error: e?.message || t('common.error') };
        }
      },

      deleteApp: async (id) => {
        await supabase.from('mini_apps').delete().eq('id', id);
        set((s) => ({ apps: s.apps.filter(a => a.id !== id) }));
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
