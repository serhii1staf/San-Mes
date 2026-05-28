import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

const appStorage: StateStorage = {
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
  badge?: string;
  is_verified?: boolean;
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
