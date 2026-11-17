import type { StateStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { kvDeleteRaw, kvGetStringRawSync, kvSetStringRaw } from '../services/kvStore';

/**
 * `persist` storage that answers from MMKV synchronously, so the store is hydrated inside `create()`,
 * before the first render.
 *
 * With plain AsyncStorage, zustand hydrates a native round trip later. For `chatSettingsStore` that
 * meant the chat list's first frames were sorted and filtered with NO archived / pinned / deleted /
 * ordered chats, and a second later rows moved or disappeared: the cold-start "jumping" of the list.
 *
 * Same keys as before (device-wide, not per account) and the AsyncStorage copy is still written, so
 * nothing is lost if MMKV is unavailable. The first launch after this change reads the old
 * AsyncStorage copy once and seeds MMKV with it.
 */
export const syncPersistStorage: StateStorage = {
  getItem: (name) => {
    const fast = kvGetStringRawSync(name);
    if (fast != null) return fast;
    return AsyncStorage.getItem(name).then((value) => {
      if (value != null) kvSetStringRaw(name, value);
      return value;
    });
  },
  setItem: (name, value) => {
    kvSetStringRaw(name, value);
    return AsyncStorage.setItem(name, value);
  },
  removeItem: (name) => {
    kvDeleteRaw(name);
    return AsyncStorage.removeItem(name);
  },
};
