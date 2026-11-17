/**
 * Posts and replies shown on a profile — the only place publishing lives now.
 *
 * There is no feed: a post is read on its author's profile («Публикации» / «Медиа») and in its own
 * thread (`app/comments/[id].tsx`); a person's comments are listed under «Ответы» on their profile.
 *
 * Caching: one page per profile, in memory for the session and on disk for the first paint of the
 * next session, refreshed in the background when older than a minute. Composing, deleting or
 * commenting calls `invalidateProfilePosts`, which refetches whatever profile is on screen.
 */
import { useEffect, useState } from 'react';
import { InteractionManager } from 'react-native';
import { apiGet } from './apiClient';
import { kvGetJSONSync, kvSetJSON } from './kvStore';

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
const FRESH_MS = 60_000;

type Entry<T> = { at: number; items: T[] };
const postsMem = new Map<string, Entry<ProfilePost>>();
const repliesMem = new Map<string, Entry<ProfileReply>>();
const listeners = new Set<(profileId: string | null) => void>();

const diskKey = (profileId: string) => `profile_posts:${profileId}`;

/** Reposts are a feed concept; they are not shown on profiles. */
function isRepostContent(content: unknown): boolean {
  return typeof content === 'string' && content.startsWith('::repost::');
}

/** Drop cached pages so the next read refetches. `undefined` clears every profile. */
export function invalidateProfilePosts(profileId?: string | null): void {
  if (profileId) {
    postsMem.delete(profileId);
    repliesMem.delete(profileId);
  } else {
    postsMem.clear();
    repliesMem.clear();
  }
  for (const l of listeners) {
    try { l(profileId ?? null); } catch {}
  }
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

function useCachedList<T>(
  profileId: string | undefined,
  mem: Map<string, Entry<T>>,
  fetcher: (id: string) => Promise<T[] | null>,
  disk?: { read: (id: string) => T[] | null; write: (id: string, items: T[]) => void },
): { items: T[]; loading: boolean } {
  const [items, setItems] = useState<T[]>(() => {
    if (!profileId) return [];
    return mem.get(profileId)?.items ?? disk?.read(profileId) ?? [];
  });
  const [loading, setLoading] = useState<boolean>(() => !!profileId && !mem.get(profileId) && !disk?.read(profileId));
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const onInvalidate = (id: string | null) => {
      if (!id || id === profileId) setNonce((n) => n + 1);
    };
    listeners.add(onInvalidate);
    return () => { listeners.delete(onInvalidate); };
  }, [profileId]);

  useEffect(() => {
    if (!profileId) return;
    const cached = mem.get(profileId);
    if (cached) {
      setItems(cached.items);
      setLoading(false);
      if (Date.now() - cached.at < FRESH_MS) return;
    }
    let alive = true;
    // After the push transition: the cached page (if any) is already on screen.
    const handle = InteractionManager.runAfterInteractions(() => {
      fetcher(profileId)
        .then((next) => {
          if (!alive) return;
          if (next) {
            mem.set(profileId, { at: Date.now(), items: next });
            disk?.write(profileId, next);
            setItems(next);
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

const postsDisk = {
  read: (id: string) => {
    try {
      const v = kvGetJSONSync<ProfilePost[] | null>(diskKey(id), null);
      return Array.isArray(v) ? v : null;
    } catch {
      return null;
    }
  },
  write: (id: string, items: ProfilePost[]) => {
    try { kvSetJSON(diskKey(id), items.slice(0, PAGE)); } catch {}
  },
};

export function useProfilePosts(profileId: string | undefined) {
  const { items, loading } = useCachedList<ProfilePost>(profileId, postsMem, fetchPosts, postsDisk);
  return { posts: items, loading };
}

/** Pass `undefined` until the «Ответы» tab is opened, so the request is only made when needed. */
export function useProfileReplies(profileId: string | undefined) {
  const { items, loading } = useCachedList<ProfileReply>(profileId, repliesMem, fetchReplies);
  return { replies: items, loading };
}
