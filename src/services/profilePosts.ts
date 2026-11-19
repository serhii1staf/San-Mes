/**
 * Posts and replies shown on a profile — the only place publishing lives now.
 *
 * There is no feed: a post is read on its author's profile («Публикации» / «Медиа») and in its own
 * thread (`app/comments/[id].tsx`); a person's comments are listed under «Ответы» on their profile.
 *
 * Caching: one page per profile, in memory for the session and on disk (with the time it was
 * fetched) for the first paint of the next session. A page younger than FRESH_MS is not refetched,
 * whether it came from memory or from disk; older pages are shown at once and refreshed in the
 * background. Composing, editing or deleting a post calls `invalidateProfilePosts`, and commenting
 * calls `invalidateProfileReplies`, which refetch whatever profile is on screen.
 */
import { useEffect, useState } from 'react';
import { InteractionManager } from 'react-native';
import { apiGet } from './apiClient';
import { kvGetJSONSync, kvSetJSON } from './kvStore';
import { useAuthStore } from '../store/authStore';

export interface ProfilePostAuthor {
  id: string;
  username?: string;
  display_name?: string;
  emoji?: string;
  badge?: string | null;
  is_verified?: boolean;
}

export interface ProfilePost {
  id: string;
  author_id: string;
  content: string;
  image_url: string | null;
  likes_count: number;
  comments_count: number;
  created_at: string;
  profiles?: ProfilePostAuthor | null;
}

export interface ProfileReply {
  id: string;
  post_id: string;
  content: string;
  created_at: string;
  posts?: {
    id: string;
    content: string | null;
    image_url: string | null;
    author_id: string | null;
    profiles?: ProfilePostAuthor | null;
  } | null;
}

const PAGE = 30;
/**
 * How long a fetched page is trusted. Was one minute, which made flipping between profiles and tabs
 * a stream of refetches: every one is a Worker request, and the cards no longer show counters, so
 * the only thing a refetch can bring is a post the person published in the meantime. Your own
 * changes invalidate immediately and do not wait for this.
 */
const FRESH_MS = 5 * 60_000;
/**
 * Someone else's page is trusted for 20 seconds instead. Reported: "she published, and it showed up
 * for me two minutes later". Her page was still inside FRESH_MS on my device, so opening her profile
 * showed the old one. Now opening it refetches unless it was fetched moments ago: at most one request
 * per profile open, no polling, and the cached page stays on screen while the new one loads.
 */
const OTHERS_FRESH_MS = 20_000;

/** How long `profileId`'s page is trusted on this device. */
function freshFor(profileId: string): number {
  return useAuthStore.getState().user?.id === profileId ? FRESH_MS : OTHERS_FRESH_MS;
}

type Entry<T> = { at: number; items: T[] };
type InvalidationKind = 'all' | 'replies';
const postsMem = new Map<string, Entry<ProfilePost>>();
const repliesMem = new Map<string, Entry<ProfileReply>>();
const listeners = new Set<(profileId: string | null, kind: InvalidationKind) => void>();

const diskKey = (profileId: string) => `profile_posts:${profileId}`;

/** Reposts are a feed concept; they are not shown on profiles. */
function isRepostContent(content: unknown): boolean {
  return typeof content === 'string' && content.startsWith('::repost::');
}

// Posts handed to the editor by the long-press menu. The profile page may be showing its disk copy
// before the in-memory page exists, so the menu passes the post it was opened on explicitly.
const editHandoff = new Map<string, ProfilePost>();

export function rememberPostForEdit(post: ProfilePost): void {
  editHandoff.clear();
  editHandoff.set(post.id, post);
}

/** The post to edit: the one the menu handed over, else the in-memory profile pages. */
export function findCachedPost(postId: string): ProfilePost | null {
  const handed = editHandoff.get(postId);
  if (handed) return handed;
  for (const entry of postsMem.values()) {
    const hit = entry.items.find((p) => p.id === postId);
    if (hit) return hit;
  }
  return null;
}

function notify(profileId: string | null, kind: InvalidationKind): void {
  for (const l of listeners) {
    try { l(profileId, kind); } catch {}
  }
}

/** Drop cached pages so the next read refetches. `undefined` clears every profile. */
export function invalidateProfilePosts(profileId?: string | null): void {
  if (profileId) {
    postsMem.delete(profileId);
    repliesMem.delete(profileId);
    // The disk copy carries its fetch time now, so it must not be able to vouch for itself either.
    const onDisk = postsDisk.read(profileId);
    if (onDisk) postsDisk.write(profileId, onDisk.items, 0);
  } else {
    postsMem.clear();
    repliesMem.clear();
  }
  notify(profileId ?? null, 'all');
}

/**
 * Only the «Ответы» page. A comment changes the commenter's replies, and nothing on anyone's posts
 * page: the cards show no counters, so refetching the post author's page after every comment was a
 * request that could not change what is on screen.
 */
export function invalidateProfileReplies(profileId: string | null | undefined): void {
  if (!profileId) return;
  repliesMem.delete(profileId);
  notify(profileId, 'replies');
}

async function fetchPosts(profileId: string): Promise<ProfilePost[] | null> {
  const { data, error } = await apiGet<ProfilePost[]>(
    `/v1/profiles/${encodeURIComponent(profileId)}/posts?limit=${PAGE}`,
  );
  if (error || !Array.isArray(data)) return null;
  return data.filter((p) => p && p.id && !isRepostContent(p.content));
}

async function fetchReplies(profileId: string): Promise<ProfileReply[] | null> {
  const { data, error } = await apiGet<ProfileReply[]>(
    `/v1/profiles/${encodeURIComponent(profileId)}/replies?limit=${PAGE}`,
  );
  if (error || !Array.isArray(data)) return null;
  return data.filter((r) => r && r.id);
}

type DiskCache<T> = {
  read: (id: string) => Entry<T> | null;
  write: (id: string, items: T[], at?: number) => void;
};

/** Same posts, same fields, same order. Both sides come from the same JSON shape (the API or its disk copy). */
function sameJson(a: unknown[], b: unknown[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function useCachedList<T>(
  profileId: string | undefined,
  kind: 'posts' | 'replies',
  mem: Map<string, Entry<T>>,
  fetcher: (id: string) => Promise<T[] | null>,
  disk?: DiskCache<T>,
): { items: T[]; loading: boolean } {
  const [items, setItems] = useState<T[]>(() => {
    if (!profileId) return [];
    const inMem = mem.get(profileId);
    if (inMem) return inMem.items;
    // Adopted into memory here, so the effect below finds the same array (no second parse of the
    // disk copy, no re-render with an equal page) and `loading` does not read the disk a third time.
    const fromDisk = disk?.read(profileId);
    if (fromDisk) mem.set(profileId, fromDisk);
    return fromDisk?.items ?? [];
  });
  const [loading, setLoading] = useState<boolean>(() => !!profileId && !mem.get(profileId));
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const onInvalidate = (id: string | null, what: InvalidationKind) => {
      if (what === 'replies' && kind !== 'replies') return;
      if (!id || id === profileId) setNonce((n) => n + 1);
    };
    listeners.add(onInvalidate);
    return () => { listeners.delete(onInvalidate); };
  }, [profileId, kind]);

  useEffect(() => {
    if (!profileId) return;
    let cached = mem.get(profileId);
    if (!cached && disk) {
      // A page fetched minutes ago in the previous session is as good as one fetched in this one.
      // Adopted into memory so the freshness check below treats both the same way.
      const fromDisk = disk.read(profileId);
      if (fromDisk) {
        cached = fromDisk;
        mem.set(profileId, fromDisk);
      }
    }
    if (cached) {
      setItems(cached.items);
      setLoading(false);
      if (Date.now() - cached.at < freshFor(profileId)) return;
    } else {
      // Nothing to show yet: say so, instead of letting an empty list read as "no posts".
      setLoading(true);
    }
    let alive = true;
    // After the push transition: the cached page (if any) is already on screen.
    const handle = InteractionManager.runAfterInteractions(() => {
      fetcher(profileId)
        .then((next) => {
          if (!alive) return;
          if (next) {
            // ── AN UNCHANGED PAGE KEEPS THE ARRAY ALREADY ON SCREEN ───────────────────
            //
            // Most refetches (opening someone's profile again after the freshness window) return
            // exactly the page that is shown. A new array of equal posts still re-rendered the
            // whole profile: the panes, the media grid's derived list and every grid image, whose
            // inline style is a new object on each render. The fetch lands right after the push
            // animation, which is when that work is most visible. Keeping the same reference lets
            // React skip the update entirely. The timestamp is still refreshed, so the freshness
            // window restarts as before. A page of 25 posts serialises in well under a millisecond.
            const current = mem.get(profileId)?.items;
            const items = current && sameJson(current, next) ? current : next;
            mem.set(profileId, { at: Date.now(), items });
            disk?.write(profileId, items);
            setItems(items);
          }
          setLoading(false);
        })
        .catch(() => { if (alive) setLoading(false); });
    });
    return () => { alive = false; handle.cancel(); };
    // `mem`, `fetcher` and `disk` are module-level constants for each caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, nonce]);

  return { items, loading };
}

const postsDisk: DiskCache<ProfilePost> = {
  read: (id: string) => {
    try {
      const v = kvGetJSONSync<unknown>(diskKey(id), null);
      // Written as a bare array before the fetch time was stored: usable for the first paint, but
      // too old to vouch for, so it is still refreshed.
      if (Array.isArray(v)) return { at: 0, items: v as ProfilePost[] };
      if (v && typeof v === 'object' && Array.isArray((v as any).items)) {
        const at = Number((v as any).at);
        return { at: Number.isFinite(at) ? at : 0, items: (v as any).items as ProfilePost[] };
      }
      return null;
    } catch {
      return null;
    }
  },
  write: (id: string, items: ProfilePost[], at: number = Date.now()) => {
    try { kvSetJSON(diskKey(id), { at, items: items.slice(0, PAGE) }); } catch {}
  },
};

/** The cached first page for a profile (memory, else disk), without fetching. For warm-ups. */
export function peekCachedProfilePosts(profileId: string): ProfilePost[] {
  const inMem = postsMem.get(profileId);
  if (inMem) return inMem.items;
  return postsDisk.read(profileId)?.items ?? [];
}

export function useProfilePosts(profileId: string | undefined) {
  const { items, loading } = useCachedList<ProfilePost>(profileId, 'posts', postsMem, fetchPosts, postsDisk);
  return { posts: items, loading };
}

/** Pass `undefined` until the «Ответы» tab is opened, so the request is only made when needed. */
export function useProfileReplies(profileId: string | undefined) {
  const { items, loading } = useCachedList<ProfileReply>(profileId, 'replies', repliesMem, fetchReplies);
  return { replies: items, loading };
}
