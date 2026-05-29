import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { User } from './authStore';

const storage: StateStorage = {
  setItem: async (name, value) => { await AsyncStorage.setItem(name, value); },
  getItem: async (name) => { return await AsyncStorage.getItem(name); },
  removeItem: async (name) => { await AsyncStorage.removeItem(name); },
};

export interface SavedAccount {
  id: string;
  username: string;
  displayName: string;
  emoji: string;
  deviceKey: string;
  pin: string;
  badge?: string;
  is_verified?: boolean;
}

interface AccountsStore {
  accounts: SavedAccount[];
  addAccount: (account: SavedAccount) => void;
  removeAccount: (id: string) => void;
  getAccount: (id: string) => SavedAccount | undefined;
}

export const useAccountsStore = create<AccountsStore>()(
  persist(
    (set, get) => ({
      accounts: [],
      addAccount: (account) => set((state) => {
        const exists = state.accounts.find(a => a.id === account.id);
        if (exists) {
          return { accounts: state.accounts.map(a => a.id === account.id ? account : a) };
        }
        if (state.accounts.length >= 3) return state; // Max 3 accounts
        return { accounts: [...state.accounts, account] };
      }),
      removeAccount: (id) => set((state) => ({
        accounts: state.accounts.filter(a => a.id !== id),
      })),
      getAccount: (id) => get().accounts.find(a => a.id === id),
    }),
    {
      name: 'saved-accounts',
      storage: createJSONStorage(() => storage),
    }
  )
);
