import { KEYS, cacheGet, cacheSet } from './cacheService';
import { useEntityStore } from './entityStore';
import {
  deletePost,
  toggleLike,
  followUser,
  unfollowUser,
  updateProfile,
  uploadPostImage,
  joinImageUrls,
} from '../lib/supabase';
// apiPost is imported directly so create/insert mutations can carry a
// `clientMutationId` field in their request body (see H2 below). The thin
// supabase.ts wrappers (createPost/createComment/sendMessage/createRepost)
// build their bodies internally and don't accept this field; since this task
// must not edit those files, the create-path requests are issued here via
// apiClient instead — same endpoints + bodies, plus the idempotency key.
import { apiPost } from './apiClient';

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
  /**
   * Stable, per-mutation idempotency key (RFC4122-ish v4 string). Generated
   * exactly ONCE when the mutation is enqueued and persisted with the record,
   * so every retry of the SAME logical mutation reuses the SAME id. Attached
   * to the outgoing request body for create/insert mutations so the server can
   * dedupe a retry of a request whose success response was lost (see H2).
   */
  clientMutationId: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_IMAGE_RETRIES = 3;
const BATCH_THRESHOLD = 50;
const BATCH_SIZE = 10;
// Per-ITEM transient-retry ceiling. After this many failed send attempts a
// mutation stops being auto-retried and is PARKED as a terminal 'failed'
// record (see markFailed). It is deliberately NOT dropped — user mutations
// must never be silently discarded (M1 constraint). Parked items are surfaced
// via a console.warn so a permanent failure is visible rather than looping.
const MAX_RETRIES = 5;

// ─── Online retry/backoff (M1) ─────────────────────────────────────────────
//
// When a queued item fails transiently while the connection is otherwise
// stable (a 5xx or a single dropped request), we no longer wait for the next
// offline→online edge or app restart. processQueue schedules its own drain
// with exponential backoff: 2s, 4s, 8s, 16s, 32s, capped at 60s. The backoff
// resets to the base the moment a drain makes any progress, and is cleared
// entirely when the queue empties or the device goes offline (the connectivity
// monitor's online edge resumes draining from there).
const RETRY_BACKOFF_BASE_MS = 2000;
const RETRY_BACKOFF_CAP_MS = 60000;
// Short delay used to continue draining a large queue across batches when no
// failure occurred (e.g. >BATCH_THRESHOLD items split into BATCH_SIZE chunks).
const CONTINUE_DRAIN_MS = 250;

// ─── Temp ID Generation ──────────────────────────────────────────────────────

export function generateTempId(): string {
  return `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// ─── Client Mutation Id (idempotency key) ─────────────────────────────────────

// Generates an RFC4122-ish v4 UUID string. No uuid dependency exists in the
// app (only fast-check's fc.uuid() in tests), so this small inline generator is
// used. It is NOT cryptographically strong, but is collision-resistant enough
// to dedupe retries of the same logical mutation — which is its only job. The
// authoritative dedup will live server-side; until then the server ignores the
// unknown field, so sending it is safe and forward-compatible.
export function generateClientMutationId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
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
  const target = queue.find((m) => m.id === id);
  if (!target) return;

  const nextRetryCount = target.retryCount + 1;

  if (nextRetryCount >= MAX_RETRIES) {
    // Per-item retry ceiling reached. PARK the mutation as a terminal 'failed'
    // record instead of dropping it: the M1 constraint forbids silently
    // discarding user mutations. processQueue only auto-processes 'pending'
    // records, so a 'failed' item stops looping but is preserved in the
    // persisted queue (e.g. for a future manual retry / inspection). Surface
    // it so a permanent failure is visible rather than vanishing.
    const updated = queue.map((m) =>
      m.id === id ? { ...m, status: 'failed' as const, retryCount: nextRetryCount } : m
    );
    await cacheSet(KEYS.mutations, updated);
    console.warn(
      '[OfflineQueue] Mutation exhausted retries — parked as failed (kept, not dropped):',
      { id: target.id, type: target.type, retryCount: nextRetryCount }
    );
    return;
  }

  // Still under the ceiling — bump the counter and keep it 'pending' so the
  // next drain cycle actually retries it. (Marking it 'failed' here is what
  // previously stranded these records: failed items are never re-processed, so
  // retryCount never advanced.)
  const updated = queue.map((m) =>
    m.id === id ? { ...m, status: 'pending' as const, retryCount: nextRetryCount } : m
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

// ─── Coalescing ──────────────────────────────────────────────────────────────

// Returns a "coalescing key" for idempotent, toggle-style mutations whose
// repeated enqueues should collapse instead of piling up in the queue.
// Returns null for mutation types that MUST NOT be coalesced (create_post,
// create_comment, create_repost, delete_post, update_profile, send_message)
// — those are not idempotent toggles and every record must be preserved.
//
// follow and unfollow intentionally share the same key for a given
// (follower, following) pair: they are inverse operations on the same
// target, so the latest one should win.
function coalesceKey(type: MutationType, payload: any): string | null {
  switch (type) {
    case 'toggle_like':
      return `toggle_like:${payload?.userId}:${payload?.postId}`;
    case 'follow':
    case 'unfollow':
      return `follow:${payload?.followerId}:${payload?.followingId}`;
    default:
      return null;
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
    // Generated ONCE here and persisted with the record so retries of this
    // same logical mutation reuse the same idempotency key (H2).
    clientMutationId: generateClientMutationId(),
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

  // Coalesce idempotent toggle-style mutations so rapid offline toggles
  // (like→unlike→like, follow→unfollow→follow) don't pile up as separate
  // records that would each replay on reconnect and risk a double-apply.
  // Non-toggle types (create_*/delete_post/update_profile/send_message)
  // have a null key and fall straight through to the plain push below.
  const key = coalesceKey(type, payload);
  if (key !== null) {
    if (type === 'toggle_like') {
      // toggleLike is a *relative* server toggle (it flips whatever the
      // current like state is). Two queued toggles for the same post
      // therefore cancel out. Pair this enqueue with one pending toggle for
      // the same (user, post): if one exists, drop it and DON'T enqueue the
      // new one (net effect = zero); otherwise enqueue this one. This keeps
      // the queued net effect equal to the parity of the user's taps, which
      // is the only way to stay correct against a relative-toggle endpoint.
      const idx = queue.findIndex(
        (m) => m.type === 'toggle_like' && coalesceKey(m.type, m.payload) === key
      );
      if (idx !== -1) {
        queue.splice(idx, 1);
        await cacheSet(KEYS.mutations, queue);
        return;
      }
      queue.push(mutation);
      await cacheSet(KEYS.mutations, queue);
      return;
    }

    // follow / unfollow are *absolute*, idempotent operations ("ensure
    // following" / "ensure not following"). Last-write-wins: drop any queued
    // follow/unfollow for this (follower, following) pair and enqueue only
    // the newest action.
    const filtered = queue.filter((m) => coalesceKey(m.type, m.payload) !== key);
    filtered.push(mutation);
    await cacheSet(KEYS.mutations, filtered);
    return;
  }

  // Non-coalescable mutation type — preserve every record.
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

        // Issued via apiClient (not the createPost wrapper) so the idempotency
        // key rides along in the body. Same endpoint + fields as createPost.
        const { data: post, error } = await apiPost<any>('/v1/posts', {
          content: payload.content,
          image_url: imageUrl ?? null,
          clientMutationId: mutation.clientMutationId,
        });
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
        // Via apiClient so clientMutationId is in the body. Same endpoint/body
        // as createComment.
        const { error } = await apiPost(
          `/v1/posts/${encodeURIComponent(payload.postId)}/comments`,
          { content: payload.content, clientMutationId: mutation.clientMutationId }
        );
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
        // Via apiClient so clientMutationId is in the body. Same endpoint/body
        // as sendMessage.
        const { error } = await apiPost(
          `/v1/conversations/${encodeURIComponent(payload.conversationId)}/messages`,
          { text: payload.text, clientMutationId: mutation.clientMutationId }
        );
        if (error) return classifyError(error);
        return { success: true, retryable: false };
      }

      case 'create_repost': {
        // Via apiClient so clientMutationId is in the body. Same endpoint/body
        // as createRepost.
        const { data: post, error } = await apiPost<any>('/v1/posts/repost', {
          originalPostId: payload.originalPostId,
          comment: payload.comment ?? '',
          clientMutationId: mutation.clientMutationId,
        });
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

// In-flight guard: prevents overlapping concurrent drains (e.g. the
// connectivity online-edge trigger firing while a backoff-scheduled drain is
// mid-flight). Only one drain runs at a time.
let draining = false;

// Handle for the self-scheduled backoff/continuation drain. Non-null means a
// future drain is pending. Cleared when the queue empties or we go offline.
let drainTimer: ReturnType<typeof setTimeout> | null = null;

// Exponential-backoff step counter. Grows on each consecutive retryable
// failure, resets to 0 the moment a drain makes progress or the queue drains.
let backoffAttempt = 0;

function clearScheduledDrain(): void {
  if (drainTimer) {
    clearTimeout(drainTimer);
    drainTimer = null;
  }
}

// Schedule the next drain after `delayMs`, replacing any already-scheduled one.
function scheduleDrain(delayMs: number): void {
  clearScheduledDrain();
  drainTimer = setTimeout(() => {
    drainTimer = null;
    // Fire-and-forget; processQueue guards its own reentrancy.
    void processQueue();
  }, delayMs);
}

// Cheap read of the current connectivity state (no network ping). Optimistic at
// very early startup before the store is initialised.
async function isOnlineNow(): Promise<boolean> {
  try {
    const { useConnectivityStore } = await import('./connectivityMonitor');
    return useConnectivityStore.getState().isOnline;
  } catch {
    return true;
  }
}

// Ordering key for mutations whose relative order must be preserved within a
// group. Messages within a single conversation must arrive in order, so a
// transient failure of one message must NOT let a later message in the SAME
// conversation jump ahead. Returns null for types with no ordering constraint
// (likes, follows, profile edits, independent posts) — those keep draining.
function orderingKey(mutation: MutationRecord): string | null {
  switch (mutation.type) {
    case 'send_message':
      return `conv:${mutation.payload?.conversationId}`;
    default:
      return null;
  }
}

export async function processQueue(): Promise<void> {
  // Guard against overlapping drains.
  if (draining) return;
  draining = true;

  try {
    // If we're offline, stop any pending backoff and bail. The connectivity
    // monitor's offline→online edge re-triggers processQueue, so we resume
    // from there rather than burning retries against a dead link.
    if (!(await isOnlineNow())) {
      clearScheduledDrain();
      backoffAttempt = 0;
      return;
    }

    const queue = await getQueue();
    const pending = queue.filter((m) => m.status === 'pending');
    if (pending.length === 0) {
      // Nothing left to do — clear any scheduled backoff.
      clearScheduledDrain();
      backoffAttempt = 0;
      return;
    }

    // Batch size: 10 if queue > 50, otherwise process all
    const batchSize = pending.length > BATCH_THRESHOLD ? BATCH_SIZE : pending.length;
    const batch = pending.slice(0, batchSize);

    let sawSuccess = false;
    let sawRetryableFailure = false;
    // Ordering groups that hit a transient failure this pass: subsequent
    // items in the same group are skipped to preserve order; they retry on
    // the next (backoff) drain behind the still-failing head.
    const blockedGroups = new Set<string>();

    for (const mutation of batch) {
      const group = orderingKey(mutation);
      if (group && blockedGroups.has(group)) {
        // Head of this ordering group failed transiently — preserve order by
        // not sending later items in the group ahead of it.
        continue;
      }

      try {
        const result = await sendToServer(mutation);
        if (result.success) {
          await removeMutation(mutation.id);
          sawSuccess = true;
        } else if (result.retryable) {
          // 5xx/network/transient. Bump the retry counter (markFailed parks
          // the item once it exhausts MAX_RETRIES, otherwise keeps it
          // 'pending'). Do NOT abort the whole batch — keep draining other
          // independent items so one stuck mutation can't block the rest.
          await markFailed(mutation.id);
          sawRetryableFailure = true;
          if (group) blockedGroups.add(group);
        } else {
          // 4xx — non-retryable. Record the failure and continue; markFailed
          // bumps the counter and eventually parks it.
          await markFailed(mutation.id);
        }
      } catch (e) {
        // Unexpected error — treat as transient for this item and keep going.
        console.warn('[OfflineQueue] Unexpected error in processQueue:', e);
        await markFailed(mutation.id);
        sawRetryableFailure = true;
        if (group) blockedGroups.add(group);
      }
    }

    // Any progress resets the backoff so the next transient blip starts from
    // the base delay rather than an already-grown one.
    if (sawSuccess) backoffAttempt = 0;

    // Re-read to decide whether more draining is warranted.
    const after = await getQueue();
    const stillPending = after.filter((m) => m.status === 'pending');

    if (stillPending.length === 0) {
      clearScheduledDrain();
      backoffAttempt = 0;
      return;
    }

    if (sawRetryableFailure) {
      // Schedule a bounded exponential-backoff retry instead of waiting for an
      // offline→online edge: 2s, 4s, 8s … capped at RETRY_BACKOFF_CAP_MS.
      const delayMs = Math.min(
        RETRY_BACKOFF_BASE_MS * 2 ** backoffAttempt,
        RETRY_BACKOFF_CAP_MS
      );
      backoffAttempt += 1;
      scheduleDrain(delayMs);
    } else {
      // No failure, but items remain (large queue split across batches, or
      // ordering-skipped items behind nothing). Continue promptly.
      scheduleDrain(CONTINUE_DRAIN_MS);
    }
  } catch (e) {
    console.warn('[OfflineQueue] processQueue failed:', e);
  } finally {
    draining = false;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
