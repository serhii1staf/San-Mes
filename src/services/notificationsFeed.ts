// Shared notifications fetch + cache writer.
//
// Single source of truth for turning the Worker's `/v1/notifications`
// payload (raw likes / comments / follows targeting the current user)
// into the uniform `NotificationItem[]` feed AND persisting it to the
// `@san:notifications` MMKV cache.
//
// Two callers share this so the cache format never diverges:
//   1. `app/notifications.tsx` — renders the list; calls this on mount /
//      pull-to-refresh, then `markAllSeen()`.
//   2. `src/store/notificationsBadgeStore.ts` — `refresh()` calls this in
//      the BACKGROUND on home-tab focus so the bell badge reflects server
//      truth WITHOUT the user opening the notifications screen first. It
//      does NOT mark anything seen.
//
// Keeping the fetch here (instead of duplicating it in the badge store)
// guarantees the badge counts exactly the items the screen would show.

import { apiGet } from './apiClient';
import { kvSetJSON } from './kvStore';

export type NotificationKind = 'like' | 'comment' | 'follow';

export interface NotificationItem {
  id: string;          // synthetic — `${kind}:${pk}`
  kind: NotificationKind;
  ts: string;          // ISO created_at
  actorId: string;
  actorName: string;
  actorUsername: string;
  actorEmoji: string;
  actorVerified?: boolean;
  postId?: string;
  postPreview?: string;
  commentText?: string;
}

// Same key the badge store reads and the notifications screen hydrates from.
export const NOTIFICATIONS_CACHE_KEY = '@san:notifications';

// Cap mirrors the notifications screen — keeps the cache (and the badge
// scan) bounded regardless of how active the account is.
const MAX_ITEMS = 150;

/**
 * Fetch the latest notifications from the Worker, normalise them into the
 * uniform feed shape, write them to the `@san:notifications` cache, and
 * return the trimmed list. Returns `null` on any network / shape error so
 * callers can leave whatever they already have on screen untouched.
 *
 * Pure data path — no UI state, no `markAllSeen`. Safe to call from a
 * background task.
 */
export async function fetchAndCacheNotifications(): Promise<NotificationItem[] | null> {
  const { data, error } = await apiGet<{
    likes: any[];
    comments: any[];
    follows: any[];
  }>('/v1/notifications');
  if (error || !data) return null;

  // Best-effort post-preview map from the entity store (already holds every
  // post the user has rendered recently). Missing entries just yield no
  // preview — never a network round-trip from here.
  let postsById: Record<string, any> = {};
  try {
    const { useEntityStore } = await import('../store');
    postsById = useEntityStore.getState().posts || {};
  } catch {}

  const previewFor = (postId: string | undefined): string | undefined => {
    if (!postId) return undefined;
    const p = postsById[postId];
    if (!p) return undefined;
    return (p.content || '').replace(/^::[a-z]+::[^:]+::/i, '').trim().slice(0, 80);
  };

  const profileOf = (row: any) => (Array.isArray(row?.profiles) ? row.profiles[0] : row?.profiles);

  const merged: NotificationItem[] = [];

  for (const r of data.likes || []) {
    const p = profileOf(r);
    if (!p) continue;
    merged.push({
      id: `like:${p.id}:${r.post_id}:${r.created_at}`,
      kind: 'like',
      ts: r.created_at,
      actorId: p.id,
      actorName: p.display_name || 'User',
      actorUsername: p.username || 'user',
      actorEmoji: p.emoji || '😊',
      actorVerified: !!p.is_verified,
      postId: r.post_id,
      postPreview: previewFor(r.post_id),
    });
  }
  for (const r of data.comments || []) {
    const p = profileOf(r);
    if (!p) continue;
    merged.push({
      id: `comment:${r.id}`,
      kind: 'comment',
      ts: r.created_at,
      actorId: p.id,
      actorName: p.display_name || 'User',
      actorUsername: p.username || 'user',
      actorEmoji: p.emoji || '😊',
      actorVerified: !!p.is_verified,
      postId: r.post_id,
      postPreview: previewFor(r.post_id),
      // Keep the FULL content — the screen's `stripMediaTokens` needs the
      // closing "::" terminator of a reply marker, which a premature slice
      // would chop off.
      commentText: r.content || '',
    });
  }
  for (const r of data.follows || []) {
    const p = profileOf(r);
    if (!p) continue;
    merged.push({
      id: `follow:${p.id}:${r.created_at}`,
      kind: 'follow',
      ts: r.created_at,
      actorId: p.id,
      actorName: p.display_name || 'User',
      actorUsername: p.username || 'user',
      actorEmoji: p.emoji || '😊',
      actorVerified: !!p.is_verified,
    });
  }

  // Newest first, bounded.
  merged.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
  const trimmed = merged.slice(0, MAX_ITEMS);
  try { kvSetJSON(NOTIFICATIONS_CACHE_KEY, { ts: Date.now(), data: trimmed }); } catch {}
  return trimmed;
}
