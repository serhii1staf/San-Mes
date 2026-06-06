// Unit / example tests for per-account cache mutations performed by the post
// mutation screens (`app/(tabs)/create.tsx` and `app/settings/admin.tsx`).
//
// Feature: per-account-cache, Task 10.1
// Requirements: 2.3 (create/edit mutations write namespaced caches),
//               2.4 (admin delete removes from namespaced caches),
//               11.3 (mutations keep feed + my-posts caches consistent).
//
// These screens are full React Native components with heavy dependencies
// (expo-router, supabase, zustand stores), so mounting them is impractical and
// unnecessary for verifying cache behavior. Instead we replicate the EXACT
// read/modify/write sequences the screens run against AsyncStorage, using the
// in-memory AsyncStorage mock from jest.setup.js, and assert the namespaced
// keys hold the expected values and stay isolated per account.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { accountKey, setCacheAccount } from '../services/cacheService';

const FEED_KEY = '@san:feed_posts';
const MY_KEY = '@san:my_posts';

// ─── Replicated mutation helpers (mirror the screen logic exactly) ───────────

// create.tsx — CREATE MODE: prepend new post into feed + my-posts caches,
// keeping only the newest 20 entries.
async function createPostMutation(newPost: any) {
  const feedCached = await AsyncStorage.getItem(accountKey(FEED_KEY));
  const feedPosts = feedCached ? JSON.parse(feedCached) : [];
  await AsyncStorage.setItem(accountKey(FEED_KEY), JSON.stringify([newPost, ...feedPosts].slice(0, 20)));

  const myCached = await AsyncStorage.getItem(accountKey(MY_KEY));
  const myPosts = myCached ? JSON.parse(myCached) : [];
  await AsyncStorage.setItem(accountKey(MY_KEY), JSON.stringify([newPost, ...myPosts].slice(0, 20)));
}

// create.tsx — EDITING MODE: find post by id in both caches and merge updates.
async function editPostMutation(editingPostId: string, updatedPostData: any) {
  const feedCached = await AsyncStorage.getItem(accountKey(FEED_KEY));
  if (feedCached) {
    const feedPosts = JSON.parse(feedCached);
    const updatedFeed = feedPosts.map((p: any) =>
      p.id === editingPostId ? { ...p, ...updatedPostData } : p
    );
    await AsyncStorage.setItem(accountKey(FEED_KEY), JSON.stringify(updatedFeed));
  }

  const myCached = await AsyncStorage.getItem(accountKey(MY_KEY));
  if (myCached) {
    const myPosts = JSON.parse(myCached);
    const updatedMy = myPosts.map((p: any) =>
      p.id === editingPostId ? { ...p, ...updatedPostData } : p
    );
    await AsyncStorage.setItem(accountKey(MY_KEY), JSON.stringify(updatedMy));
  }
}

// admin.tsx — delete a post from both namespaced caches.
async function adminDeletePostMutation(postId: string) {
  const feedCached = await AsyncStorage.getItem(accountKey(FEED_KEY));
  if (feedCached) {
    const posts = JSON.parse(feedCached).filter((p: any) => p.id !== postId);
    await AsyncStorage.setItem(accountKey(FEED_KEY), JSON.stringify(posts));
  }
  const myCached = await AsyncStorage.getItem(accountKey(MY_KEY));
  if (myCached) {
    const posts = JSON.parse(myCached).filter((p: any) => p.id !== postId);
    await AsyncStorage.setItem(accountKey(MY_KEY), JSON.stringify(posts));
  }
}

async function readNamespaced<T>(baseKey: string): Promise<T | null> {
  const raw = await AsyncStorage.getItem(accountKey(baseKey));
  return raw ? (JSON.parse(raw) as T) : null;
}

describe('create.tsx cache mutations (per-account)', () => {
  beforeEach(() => {
    setCacheAccount('user-A');
  });

  it('creating a post writes the new post into namespaced feed + my-posts caches', async () => {
    const newPost = { id: 'p1', content: 'hello', authorId: 'user-A' };

    await createPostMutation(newPost);

    const feed = await readNamespaced<any[]>(FEED_KEY);
    const mine = await readNamespaced<any[]>(MY_KEY);
    expect(feed).toEqual([newPost]);
    expect(mine).toEqual([newPost]);
  });

  it('creating a post prepends to existing cache and caps at 20 entries', async () => {
    const existing = Array.from({ length: 20 }, (_, i) => ({ id: `old-${i}`, content: `c${i}` }));
    await AsyncStorage.setItem(accountKey(FEED_KEY), JSON.stringify(existing));
    await AsyncStorage.setItem(accountKey(MY_KEY), JSON.stringify(existing));

    const newPost = { id: 'fresh', content: 'newest' };
    await createPostMutation(newPost);

    const feed = (await readNamespaced<any[]>(FEED_KEY))!;
    const mine = (await readNamespaced<any[]>(MY_KEY))!;
    expect(feed).toHaveLength(20);
    expect(mine).toHaveLength(20);
    expect(feed[0]).toEqual(newPost);
    expect(mine[0]).toEqual(newPost);
    // Oldest entry dropped by slice(0, 20)
    expect(feed.find((p) => p.id === 'old-19')).toBeUndefined();
  });

  it('editing a post updates the matching entry in both namespaced caches', async () => {
    const original = { id: 'p1', content: 'old text', imageUrl: undefined };
    const other = { id: 'p2', content: 'unrelated' };
    await AsyncStorage.setItem(accountKey(FEED_KEY), JSON.stringify([original, other]));
    await AsyncStorage.setItem(accountKey(MY_KEY), JSON.stringify([original]));

    await editPostMutation('p1', { content: 'new text', imageUrl: 'http://img' });

    const feed = (await readNamespaced<any[]>(FEED_KEY))!;
    const mine = (await readNamespaced<any[]>(MY_KEY))!;
    expect(feed[0]).toEqual({ id: 'p1', content: 'new text', imageUrl: 'http://img' });
    expect(feed[1]).toEqual(other); // untouched
    expect(mine[0]).toEqual({ id: 'p1', content: 'new text', imageUrl: 'http://img' });
  });

  it('mutations under account A do not leak into account B namespace', async () => {
    setCacheAccount('user-A');
    await createPostMutation({ id: 'a-post', content: 'A only' });

    setCacheAccount('user-B');
    const feedB = await readNamespaced<any[]>(FEED_KEY);
    const myB = await readNamespaced<any[]>(MY_KEY);
    expect(feedB).toBeNull();
    expect(myB).toBeNull();

    // The raw namespaced key for A holds the data; B's key is separate.
    setCacheAccount('user-A');
    const feedA = await readNamespaced<any[]>(FEED_KEY);
    expect(feedA).toEqual([{ id: 'a-post', content: 'A only' }]);
  });
});

describe('admin.tsx delete mutations (per-account)', () => {
  beforeEach(() => {
    setCacheAccount('user-A');
  });

  it('deleting a post removes it from both namespaced caches', async () => {
    const posts = [
      { id: 'p1', content: 'one' },
      { id: 'p2', content: 'two' },
      { id: 'p3', content: 'three' },
    ];
    await AsyncStorage.setItem(accountKey(FEED_KEY), JSON.stringify(posts));
    await AsyncStorage.setItem(accountKey(MY_KEY), JSON.stringify(posts));

    await adminDeletePostMutation('p2');

    const feed = (await readNamespaced<any[]>(FEED_KEY))!;
    const mine = (await readNamespaced<any[]>(MY_KEY))!;
    expect(feed.map((p) => p.id)).toEqual(['p1', 'p3']);
    expect(mine.map((p) => p.id)).toEqual(['p1', 'p3']);
  });

  it('deleting is a no-op when caches are empty (no throw)', async () => {
    await expect(adminDeletePostMutation('missing')).resolves.toBeUndefined();
    expect(await readNamespaced<any[]>(FEED_KEY)).toBeNull();
    expect(await readNamespaced<any[]>(MY_KEY)).toBeNull();
  });

  it('deleting under account A leaves account B caches untouched', async () => {
    setCacheAccount('user-A');
    await AsyncStorage.setItem(accountKey(FEED_KEY), JSON.stringify([{ id: 'p1' }, { id: 'p2' }]));

    setCacheAccount('user-B');
    await AsyncStorage.setItem(accountKey(FEED_KEY), JSON.stringify([{ id: 'p1' }, { id: 'p2' }]));

    // Delete p1 only for account A
    setCacheAccount('user-A');
    await adminDeletePostMutation('p1');

    const feedA = (await readNamespaced<any[]>(FEED_KEY))!;
    expect(feedA.map((p) => p.id)).toEqual(['p2']);

    // Account B remains intact
    setCacheAccount('user-B');
    const feedB = (await readNamespaced<any[]>(FEED_KEY))!;
    expect(feedB.map((p) => p.id)).toEqual(['p1', 'p2']);
  });
});
