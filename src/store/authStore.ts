import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Use AsyncStorage as reliable fallback that works in Expo Go
let appStorage: StateStorage;

try {
  const { MMKV } = require('react-native-mmkv');
  const storage = new MMKV({ id: 'auth-storage' });
  appStorage = {
    setItem: (name: string, value: string) => {
      storage.set(name, value);
    },
    getItem: (name: string) => {
      const value = storage.getString(name);
      return value ?? null;
    },
    removeItem: (name: string) => {
      storage.delete(name);
    },
  };
} catch {
  // Fallback to AsyncStorage for Expo Go
  appStorage = {
    setItem: async (name: string, value: string) => {
      await AsyncStorage.setItem(name, value);
    },
    getItem: async (name: string) => {
      return await AsyncStorage.getItem(name);
    },
    removeItem: async (name: string) => {
      await AsyncStorage.removeItem(name);
    },
  };
}

export interface UserLink {
  type: string;
  url: string;
}

export interface User {
  id: string;
  username: string;
  displayName: string;
  emoji: string;
  avatar?: string;
  bio?: string;
  pin?: string;
  deviceKey?: string;
  links?: UserLink[];
  bannerUrl?: string;
}

interface AuthStoreState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  hasHydrated: boolean;
  setHasHydrated: (hydrated: boolean) => void;
  login: (user: User, token?: string) => void;
  logout: () => void;
  setLoading: (loading: boolean) => void;
  updateProfile: (updates: Partial<User>) => void;
}

export const useAuthStore = create<AuthStoreState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
      hasHydrated: false,
      setHasHydrated: (hydrated) => set({ hasHydrated: hydrated }),
      login: (user, token) => set({ user, token: token || 'mock-token', isAuthenticated: true }),
      logout: () => set({ user: null, token: null, isAuthenticated: false }),
      setLoading: (isLoading) => set({ isLoading }),
      updateProfile: (updates) =>
        set((state) => ({
          user: state.user ? { ...state.user, ...updates } : null,
        })),
    }),
    {
      name: 'auth-state',
      storage: createJSONStorage(() => appStorage),
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        isAuthenticated: state.isAuthenticated,
      }),
      onRehydrateStorage: () => (state, error) => {
        if (state) {
          state.setHasHydrated(true);
        } else {
          useAuthStore.setState({ hasHydrated: true });
        }
      },
    }
  )
);
