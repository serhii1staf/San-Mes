import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';

let mmkvStorage: StateStorage;

try {
  const { MMKV } = require('react-native-mmkv');
  const storage = new MMKV({ id: 'auth-storage' });
  mmkvStorage = {
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
  // Fallback to no-op storage if MMKV is not available (e.g., Expo Go)
  mmkvStorage = {
    setItem: () => {},
    getItem: () => null,
    removeItem: () => {},
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
      storage: createJSONStorage(() => mmkvStorage),
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        isAuthenticated: state.isAuthenticated,
      }),
      onRehydrateStorage: () => (state, error) => {
        // Always mark as hydrated, even if rehydration fails
        if (state) {
          state.setHasHydrated(true);
        } else {
          // If state is undefined (error case), force hydration via direct store update
          useAuthStore.setState({ hasHydrated: true });
        }
      },
    }
  )
);
