// Unit / example tests for per-account search-history mutations performed by
// `app/(tabs)/search.tsx`.
//
// Feature: per-account-cache, Task 10.2
// Requirements: 3.3 (search history reads/writes the namespaced key),
//               3.4 (history is isolated to the active account's namespace).
//
// search.tsx is a full screen component; we replicate the exact AsyncStorage
// operations it performs against `accountKey('@san:search_history')` —
// loadHistory (read), addToHistory (write), clearHistory (remove) — and assert
// only the active account's namespaced key is touched.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { accountKey, setCacheAccount } from '../services/cacheService';

const SEARCH_HISTORY_KEY = '@san:search_history';

interface ProfileResult {
  id: string;
  username: string;
  display_name: string;
  emoji: string;
  bio: string;
}

function profile(id: string): ProfileResult {
  return { id, username: `u${id}`, display_name: `User ${id}`, emoji: '😊', bio: '' };
}

// search.tsx — loadHistory: read namespaced search history.
async function loadHistory(): Promise<ProfileResult[]> {
  const cached = await AsyncStorage.getItem(accountKey(SEARCH_HISTORY_KEY));
  return cached ? JSON.parse(cached) : [];
}

// search.tsx — addToHistory: prepend profile, dedupe by id, cap at 10.
async function addToHistory(history: ProfileResult[], profileToAdd: ProfileResult): Promise<ProfileResult[]> {
  const updated = [profileToAdd, ...history.filter((h) => h.id !== profileToAdd.id)].slice(0, 10);
  await AsyncStorage.setItem(accountKey(SEARCH_HISTORY_KEY), JSON.stringify(updated));
  return updated;
}

// search.tsx — clearHistory: remove namespaced search history.
async function clearHistory(): Promise<void> {
  await AsyncStorage.removeItem(accountKey(SEARCH_HISTORY_KEY));
}

describe('search.tsx search-history mutations (per-account)', () => {
  beforeEach(() => {
    setCacheAccount('user-A');
  });

  it('addToHistory writes to the active account namespaced key', async () => {
    await addToHistory([], profile('1'));

    const raw = await AsyncStorage.getItem(accountKey(SEARCH_HISTORY_KEY));
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual([profile('1')]);
  });

  it('loadHistory reads back what addToHistory wrote', async () => {
    const afterAdd = await addToHistory([], profile('1'));
    const loaded = await loadHistory();
    expect(loaded).toEqual(afterAdd);
  });

  it('addToHistory prepends, dedupes by id, and caps at 10', async () => {
    let history: ProfileResult[] = [];
    // add 12 distinct profiles
    for (let i = 1; i <= 12; i++) {
      history = await addToHistory(history, profile(String(i)));
    }
    expect(history).toHaveLength(10);
    // newest first
    expect(history[0]).toEqual(profile('12'));

    // re-adding an existing profile moves it to front without duplicating
    history = await addToHistory(history, profile('5'));
    expect(history[0]).toEqual(profile('5'));
    expect(history.filter((h) => h.id === '5')).toHaveLength(1);
    expect(history).toHaveLength(10);
  });

  it('clearHistory removes only the active account namespaced key', async () => {
    await addToHistory([], profile('1'));
    expect(await AsyncStorage.getItem(accountKey(SEARCH_HISTORY_KEY))).not.toBeNull();

    await clearHistory();
    expect(await AsyncStorage.getItem(accountKey(SEARCH_HISTORY_KEY))).toBeNull();
    expect(await loadHistory()).toEqual([]);
  });

  it('history is isolated per account: writing under A does not affect B', async () => {
    setCacheAccount('user-A');
    await addToHistory([], profile('A1'));

    setCacheAccount('user-B');
    expect(await loadHistory()).toEqual([]);
    await addToHistory([], profile('B1'));

    // Each account sees only its own history
    expect(await loadHistory()).toEqual([profile('B1')]);
    setCacheAccount('user-A');
    expect(await loadHistory()).toEqual([profile('A1')]);
  });

  it('clearHistory under one account leaves the other account history intact', async () => {
    setCacheAccount('user-A');
    await addToHistory([], profile('A1'));
    setCacheAccount('user-B');
    await addToHistory([], profile('B1'));

    // Clear B only
    await clearHistory();
    expect(await loadHistory()).toEqual([]);

    // A still has its history
    setCacheAccount('user-A');
    expect(await loadHistory()).toEqual([profile('A1')]);
  });

  it('clearHistory only touches the search-history key, not other namespaced caches', async () => {
    setCacheAccount('user-A');
    await addToHistory([], profile('A1'));
    await AsyncStorage.setItem(accountKey('@san:feed_posts'), JSON.stringify([{ id: 'p1' }]));

    await clearHistory();

    expect(await AsyncStorage.getItem(accountKey(SEARCH_HISTORY_KEY))).toBeNull();
    // Unrelated namespaced cache survives
    expect(await AsyncStorage.getItem(accountKey('@san:feed_posts'))).not.toBeNull();
  });
});
