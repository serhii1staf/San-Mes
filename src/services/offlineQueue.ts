import { KEYS, cacheGet, cacheSet } from './cacheService';
import { useEntityStore } from './entityStore';
import {
  createPost,
  deletePost,
  toggleLike,
  createComment,
  followUser,
  unfollowUser,
  updateProfile,
  createRepost,
  uploadPostImage,
  joinImageUrls,
  sendMessage,
} from '../lib/supabase';

// ─── Types ───────────────────────────────────────────────────────────────────

export type MutationType =
  | 'create_post'
  | 'delete_post'
  | 'toggle_like'
  | 'create_comment'
  | 'follow'
  | 'unfollow'
  | 'update_profile'
  | 'send_message'
  | 'create_repost';

export interface MutationRecord {
  id: string;
  type: MutationType;
  payload: any;
  timestamp: string;
  status: 'pending' | 'failed';
  retryCount: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_IMAGE_RETRIES = 3;
const BATCH_THRESHOLD = 50;
const BATCH_SIZE = 10;

// ─── Temp ID Generation ──────────────────────────────────────────────────────

export function generateTempId(): string {
  return `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// ─── Queue CRUD ──────────────────────────────────────────────────────────────

export async function getQueue(): Promise<MutationRecord[]> {
  return cacheGet<MutationRecord[]>(KEYS.mutations, []);
}

export async function getQueueLength(): Promise<number> {
  const queue = await getQueue();
  return queue.length;
}

export async function removeMutation(id: string): Promise<void> {
  const queue = await getQueue();
  const updated = queue.filter((m) => m.id !== id);
  await cacheSet(KEYS.mutations, updated);
}

export async function markFailed(id: string): Promise<void> {
  const queue = await getQueue();
  const updated = queue.map((m) =>
    m.id === id ? { ...m, status: 'failed' as const, retryCount: m.retryCount + 1 } : m
  );
  await cacheSet(KEYS.mutations, updated);
}

// ─── Optimistic Updates ──────────────────────────────────────────────────────

function applyOptimisticUpdate(type: MutationType, payload: any): void {
  const store = useEntityStore.getState();

  switch (type) {
    case 'create_post': {
      const tempPost = {
        id: payload.tempId,
        author_id: payload.authorId,
        content: payload.content,
        image_url: null,
        likes_count: 0,
        comments_count: 0,
        shares_count: 0,
        created_at: new Date().toISOString(),
        status: 'pending' as const,
        localImageUris: payload.imageUris || [],
      };
      store.upsertPost(tempPost);
      store.setFeedIds([tempPost.id, ...store.feedIds]);
      store.setMyPostIds([tempPost.id, ...store.myPostIds]);
      break;
    }

    case 'delete_post': {
      store.removePost(payload.postId);
      break;
    }

    case 'toggle_like': {
      const { userId, postId, liked } = payload;
      if (liked) {
        store.setLike(userId, postId);
        // Increment likes_count on the post
        const post = store.posts[postId];
        if (post) {
          store.upsertPost({ ...post, likes_count: post.likes_count + 1 });
        }
      } else {
        store.removeLike(userId, postId);
        // Decrement likes_count on the post
        const post = store.posts[postId];
        if (post) {
          store.upsertPost({ ...post, likes_count: Math.max(post.likes_count - 1, 0) });
        }
      }
      break;
    }

    case 'create_comment': {
      const { postId } = payload;
      const post = store.posts[postId];
      if (post) {
        store.upsertPost({ ...post, comments_count: post.comments_count + 1 });
      }
      break;
    }

    case 'follow': {
      const { followerId, followingId } = payload;
      store.setFollow(followerId, followingId);
      break;
    }

    case 'unfollow': {
      const { followerId, followingId } = payload;
      store.removeFollow(followerId, followingId);
      break;
    }

    case 'send_message': {
      // No-op for now, just queue
      break;
    }

    case 'create_repost': {
      const tempRepost = {
        id: payload.tempId,
        author_id: payload.authorId,
        content: `::repost::${payload.originalPostId}::${payload.comment || ''}`,
        image_url: null,
        likes_count: 0,
        comments_count: 0,
        shares_count: 0,
        created_at: new Date().toISOString(),
        status: 'pending' as const,
      };
      store.upsertPost(tempRepost);
      store.setFeedIds([tempRepost.id, ...store.feedIds]);
      break;
    }

    case 'update_profile': {
      // Optimistic profile update handled by caller
      break;
    }
  }
}

// ─── Queue Mutation ──────────────────────────────────────────────────────────

export async function queueMutation(type: MutationType, payload: any): Promise<void> {
  const mutation: MutationRecord = {
    id: generateTempId(),
    type,
    payload,
    timestamp: new Date().toISOString(),
    status: 'pending',
    retryCount: 0,
  };

  // 1. Apply optimistic update to entity store immediately so the UI flips.
  applyOptimisticUpdate(type, payload);

  // 2. Decide between online-first send and offline-queue.
  //
  //   The previous implementation always wrote into the local queue and
  //   relied on `processQueue` running to flush it. But `processQueue` is
  //   only invoked from the connectivity monitor's offline->online edge,
  //   and the monitor's initial state is `isOnline: true` — so a user
  //   that opens the app already online would NEVER trigger a flush, and
  //   their follow/like/comment mutations would sit in AsyncStorage
  //   forever. That's why follow rows weren't actually persisting:
  //   the optimistic flag flipped, but `supabase.from('follows').insert`
  //   was never called.
  //
  //   When online we now try the network call directly. If it succeeds
  //   we don't write to the queue at all — the optimistic update already
  //   reflects the truth. If it fails (network glitch, transient 5xx)
  //   we fall through to the queue path so the connectivity monitor
  //   retries it on the next online edge.
  let isOnline = true;
  try {
    // Lazy import — avoid pulling the connectivity store into modules
    // that don't already import it (and avoid a cycle: connectivity
    // monitor lazy-imports this module).
    const { useConnectivityStore } = await import('./connectivityMonitor');
    isOnline = useConnectivityStore.getState().isOnline;
  } catch {
    // If the store isn't initialised yet (very early app startup), be
    // optimistic and try the send.
    isOnline = true;
  }

  if (isOnline) {
    try {
      const result = await sendToServer(mutation);
      if (result.success) {
        // Done — no need to enqueue. After-hooks (e.g. inserting the
        // follow notification row) live in the per-type send path.
        return;
      }
      // Non-retryable client error (e.g. duplicate follow row) — also
      // leave the queue clean. The optimistic update is already correct
      // for "already following".
      if (!result.retryable) return;
    } catch {
      // Fall through to enqueue.
    }
  }

  // 3. Persist mutation to AsyncStorage queue for retry on reconnect.
  const queue = await getQueue();
  queue.push(mutation);
  await cacheSet(KEYS.mutations, queue);
}

// ─── Image Upload with Retry ─────────────────────────────────────────────────

export async function uploadImageWithRetry(imageUri: string): Promise<string | null> {
  for (let attempt = 0; attempt < MAX_IMAGE_RETRIES; attempt++) {
    const { url, error } = await uploadPostImage(imageUri);
    if (url) return url;
    if (attempt < MAX_IMAGE_RETRIES - 1) {
      // Exponential backoff: 1s, 2s, 4s...
      await delay(1000 * Math.pow(2, attempt));
    }
  }
  return null; // All retries failed
}

// ─── Send Mutation to Server ─────────────────────────────────────────────────

interface SendResult {
  success: boolean;
  retryable: boolean;
}

async function sendToServer(mutation: MutationRecord): Promise<SendResult> {
  const { type, payload } = mutation;

  try {
    switch (type) {
      case 'create_post': {
        // Upload images first if any
        let imageUrl: string | null = null;
        if (payload.imageUris && payload.imageUris.length > 0) {
          const uploadedUrls: string[] = [];
          for (const uri of payload.imageUris) {
            const url = await uploadImageWithRetry(uri);
            if (!url) {
              // Image upload failed after retries
              return { success: false, retryable: false };
            }
            uploadedUrls.push(url);
          }
          imageUrl = joinImageUrls(uploadedUrls);
        }

        const { post, error } = await createPost(payload.authorId, payload.content, imageUrl || undefined);
        if (error) {
          return classifyError(error);
        }
        // Replace temp post with real post in store
        if (post && payload.tempId) {
          const store = useEntityStore.getState();
          store.replaceTempPost(payload.tempId, {
            id: post.id,
            author_id: post.author_id,
            content: post.content,
            image_url: post.image_url,
            likes_count: post.likes_count,
            comments_count: post.comments_count,
            shares_count: post.shares_count,
            created_at: post.created_at,
            status: 'synced',
          });
        }
        return { success: true, retryable: false };
      }

      case 'delete_post': {
        const { error } = await deletePost(payload.postId, payload.authorId);
        if (error) return classifyError(error);
        return { success: true, retryable: false };
      }

      case 'toggle_like': {
        const { error } = await toggleLike(payload.userId, payload.postId);
        if (error) return classifyError(error);
        return { success: true, retryable: false };
      }

      case 'create_comment': {
        const { error } = await createComment(payload.postId, payload.authorId, payload.content);
        if (error) return classifyError(error);
        return { success: true, retryable: false };
      }

      case 'follow': {
        const { error } = await followUser(payload.followerId, payload.followingId);
        if (error) return classifyError(error);
        return { success: true, retryable: false };
      }

      case 'unfollow': {
        const { error } = await unfollowUser(payload.followerId, payload.followingId);
        if (error) return classifyError(error);
        return { success: true, retryable: false };
      }

      case 'update_profile': {
        const { error } = await updateProfile(payload.userId, payload.updates);
        if (error) return classifyError(error);
        return { success: true, retryable: false };
      }

      case 'send_message': {
        const { error } = await sendMessage(payload.conversationId, payload.senderId, payload.text);
        if (error) return classifyError(error);
        return { success: true, retryable: false };
      }

      case 'create_repost': {
        const { post, error } = await createRepost(payload.authorId, payload.originalPostId, payload.comment);
        if (error) return classifyError(error);
        // Replace temp repost with real one
        if (post && payload.tempId) {
          const store = useEntityStore.getState();
          store.replaceTempPost(payload.tempId, {
            id: post.id,
            author_id: post.author_id,
            content: post.content,
            image_url: post.image_url,
            likes_count: post.likes_count,
            comments_count: post.comments_count,
            shares_count: post.shares_count,
            created_at: post.created_at,
            status: 'synced',
          });
        }
        return { success: true, retryable: false };
      }

      default:
        return { success: false, retryable: false };
    }
  } catch (e: any) {
    // Network error — retryable
    console.warn('[OfflineQueue] Network error processing mutation:', e?.message);
    return { success: false, retryable: true };
  }
}

// ─── Error Classification ────────────────────────────────────────────────────

function classifyError(error: string): SendResult {
  // Heuristic: if the error message suggests a client error (4xx), it's non-retryable
  // Server errors (5xx) and network errors are retryable
  const lowerError = error.toLowerCase();
  if (
    lowerError.includes('not found') ||
    lowerError.includes('unauthorized') ||
    lowerError.includes('forbidden') ||
    lowerError.includes('bad request') ||
    lowerError.includes('conflict') ||
    lowerError.includes('validation') ||
    lowerError.includes('duplicate') ||
    lowerError.includes('unique') ||
    lowerError.includes('already')
  ) {
    // 4xx-like errors — non-retryable
    return { success: false, retryable: false };
  }
  // Assume retryable (5xx / transient)
  return { success: false, retryable: true };
}

// ─── Process Queue ───────────────────────────────────────────────────────────

export async function processQueue(): Promise<void> {
  try {
    const queue = await getQueue();
    const pending = queue.filter((m) => m.status === 'pending');
    if (pending.length === 0) return;

    // Batch size: 10 if queue > 50, otherwise process all
    const batchSize = pending.length > BATCH_THRESHOLD ? BATCH_SIZE : pending.length;
    const batch = pending.slice(0, batchSize);

    for (const mutation of batch) {
      try {
        const result = await sendToServer(mutation);
        if (result.success) {
          await removeMutation(mutation.id);
        } else if (result.retryable) {
          // 5xx/network error — retain pending, stop batch
          break;
        } else {
          // 4xx — mark as failed, continue to next
          await markFailed(mutation.id);
        }
      } catch (e) {
        // Unexpected error — stop processing, retry next cycle
        console.warn('[OfflineQueue] Unexpected error in processQueue:', e);
        break;
      }
    }
  } catch (e) {
    console.warn('[OfflineQueue] processQueue failed:', e);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
