import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  clearAuthToken,
  getAuthToken,
  me as authMe,
  setAuthToken,
} from '../services/authClient';

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
  /** Owner-controlled flag: when true, viewers can't screenshot/record this account's profile & chats. */
  screenshots_disabled?: boolean;
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
  /**
   * Re-hydrate the user object from the Worker's `/v1/auth/me` if a
   * token is in MMKV. Called once on app boot from the root layout.
   * Returns `true` when the user is authenticated, `false` otherwise.
   */
  restoreSession: () => Promise<boolean>;
}

export const useAuthStore = create<AuthStoreState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
      hasHydrated: false,
      setHasHydrated: (hydrated) => set({ hasHydrated: hydrated }),
      login: (user, token) => {
        // Mirror the JWT into MMKV so apiClient picks it up immediately
        // — zustand-persist writes are async, MMKV is synchronous.
        //
        // Hardening: only write the supplied token when it actually
        // looks like a JWT (a JWS compact serialisation always starts
        // with the base64-encoded `{"` which is the literal `eyJ`).
        // The auth screens previously passed `'token-' + Date.now()`
        // here, which silently clobbered the real JWT that authClient
        // had already saved — every subsequent authed request then
        // 401'd against the Worker and the user got logged straight
        // out. Guarding here means a stray synthetic value can't ever
        // recreate that bug.
        const looksLikeJwt = typeof token === 'string' && token.startsWith('eyJ');
        if (looksLikeJwt) {
          try { setAuthToken(token!); } catch {}
        }
        const persistedToken = getAuthToken();
        set({
          user,
          token: looksLikeJwt ? token! : (persistedToken || token || 'mock-token'),
          isAuthenticated: true,
        });
      },
      logout: () => {
        try { clearAuthToken(); } catch {}
        set({ user: null, token: null, isAuthenticated: false });
      },
      setLoading: (isLoading) => set({ isLoading }),
      updateProfile: (updates) =>
        set((state) => ({
          user: state.user ? { ...state.user, ...updates } : null,
        })),
      restoreSession: async () => {
        const tok = getAuthToken();
        if (!tok) return false;
        try {
          const { profile, error } = await authMe();
          if (error || !profile) {
            // Token is dead — wipe it so the next paint shows welcome.
            try { clearAuthToken(); } catch {}
            set({ user: null, token: null, isAuthenticated: false });
            return false;
          }
          const existing = get().user;
          set({
            user: {
              id: profile.id,
              username: profile.username,
              displayName: profile.display_name,
              emoji: profile.emoji,
              bio: profile.bio,
              deviceKey: profile.device_key,
              badge: profile.badge || undefined,
              is_verified: !!profile.is_verified,
              bannerUrl: profile.banner_url || undefined,
              screenshots_disabled: !!(profile as any).screenshots_disabled,
              links: (profile.links || undefined) as any,
              // Preserve the in-memory PIN if the user already entered
              // one this session — the Worker doesn't send it back.
              pin: existing?.pin,
            },
            token: tok,
            isAuthenticated: true,
          });
          return true;
        } catch {
          return false;
        }
      },
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
