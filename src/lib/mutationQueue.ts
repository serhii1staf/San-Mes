import { getDatabase } from './database';
import { useEntityStore, LocalPost } from './entityStore';
import {
  createPost,
  deletePost,
  toggleLike,
  createComment,
  followUser,
  unfollowUser,
  updateProfile,
  createRepost,
} from './supabase';

// --- Types ---

export type MutationType =
  | 'create_post'
  | 'delete_post'
  | 'toggle_like'
  | 'create_comment'
  | 'follow'
  | 'unfollow'
  | 'update_profile'
  | 'create_repost';

interface MutationRecord {
  id: number;
  type: string;
  payload: string;
  created_at: string;
  status: string;
}

// --- Queue a mutation (apply locally + enqueue for server sync) ---

export function queueMutation(type: MutationType, payload: any): void {
  const db = getDatabase();
  const now = new Date().toISOString();

  // Enqueue for server sync
  db.runSync(
    'INSERT INTO mutation_queue (type, payload, created_at, status) VALUES (?, ?, ?, ?)',
    [type, JSON.stringify(payload), now, 'pending']
  );

  // Apply optimistic update locally
  applyMutationLocally(type, payload);
}

// --- Apply mutation to local state (optimistic) ---

function applyMutationLocally(type: MutationType, payload: any): void {
  const store = useEntityStore.getState();

  switch (type) {
    case 'create_post': {
      const post: LocalPost = {
        id: payload.tempId || `temp_${Date.now()}`,
        author_id: payload.authorId,
        content: payload.content,
        image_url: payload.imageUrl || null,
        likes_count: 0,
        comments_count: 0,
        shares_count: 0,
        created_at: new Date().toISOString(),
        updated_at: null,
      };
      store.upsertPost(post);
      // Prepend to feed and my posts
      useEntityStore.setState((state) => ({
        feedIds: [post.id, ...state.feedIds],
        myPostIds: [post.id, ...state.myPostIds],
      }));
      break;
    }

    case 'create_repost': {
      const post: LocalPost = {
        id: payload.tempId || `temp_repost_${Date.now()}`,
        author_id: payload.authorId,
        content: `::repost::${payload.originalPostId}::${payload.comment || ''}`,
        image_url: null,
        likes_count: 0,
        comments_count: 0,
        shares_count: 0,
        created_at: new Date().toISOString(),
        updated_at: null,
      };
      store.upsertPost(post);
      useEntityStore.setState((state) => ({
        feedIds: [post.id, ...state.feedIds],
        myPostIds: [post.id, ...state.myPostIds],
      }));
      // Increment shares_count on original post locally
      const origPost = store.getPost(payload.originalPostId);
      if (origPost) {
        store.upsertPost({ ...origPost, shares_count: origPost.shares_count + 1 });
      }
      break;
    }

    case 'delete_post': {
      store.removePost(payload.postId);
      break;
    }

    case 'toggle_like': {
      const isCurrentlyLiked = store.isLiked(payload.userId, payload.postId);
      const post = store.getPost(payload.postId);
      if (isCurrentlyLiked) {
        store.removeLike(payload.userId, payload.postId);
        if (post) {
          store.upsertPost({ ...post, likes_count: Math.max(0, post.likes_count - 1) });
        }
      } else {
        store.setLike(payload.userId, payload.postId);
        if (post) {
          store.upsertPost({ ...post, likes_count: post.likes_count + 1 });
        }
      }
      break;
    }

    case 'create_comment': {
      const post = store.getPost(payload.postId);
      if (post) {
        store.upsertPost({ ...post, comments_count: post.comments_count + 1 });
      }
      break;
    }

    case 'follow': {
      store.setFollow(payload.followerId, payload.followingId);
      break;
    }

    case 'unfollow': {
      store.removeFollow(payload.followerId, payload.followingId);
      break;
    }

    case 'update_profile': {
      const existing = store.getProfile(payload.userId);
      if (existing) {
        store.upsertProfile({
          ...existing,
          ...payload.updates,
          updated_at: new Date().toISOString(),
        });
      }
      break;
    }
  }
}

// --- Process the mutation queue (send pending mutations to server) ---

export async function processQueue(): Promise<void> {
  const db = getDatabase();
  const pending = db.getAllSync<MutationRecord>(
    'SELECT * FROM mutation_queue WHERE status = ? ORDER BY id ASC LIMIT 20',
    ['pending']
  );

  for (const mutation of pending) {
    try {
      const payload = JSON.parse(mutation.payload);
      const success = await sendMutationToServer(mutation.type as MutationType, payload);

      if (success) {
        db.runSync(
          'UPDATE mutation_queue SET status = ? WHERE id = ?',
          ['completed', mutation.id]
        );
      } else {
        db.runSync(
          'UPDATE mutation_queue SET status = ? WHERE id = ?',
          ['failed', mutation.id]
        );
      }
    } catch (e) {
      // Network error — leave as pending for retry
      console.warn('[MutationQueue] Failed to process mutation:', mutation.id, e);
      break; // Stop processing if network is down
    }
  }

  // Clean up old completed mutations (keep last 24h)
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  db.runSync(
    'DELETE FROM mutation_queue WHERE status = ? AND created_at < ?',
    ['completed', cutoff]
  );
}

// --- Send a single mutation to the server ---

async function sendMutationToServer(type: MutationType, payload: any): Promise<boolean> {
  switch (type) {
    case 'create_post': {
      const { post, error } = await createPost(payload.authorId, payload.content, payload.imageUrl);
      if (error) return false;
      // Replace temp post with real one in local store
      if (post && payload.tempId) {
        const store = useEntityStore.getState();
        store.removePost(payload.tempId);
        store.upsertPost({
          id: post.id,
          author_id: post.author_id,
          content: post.content,
          image_url: post.image_url,
          likes_count: post.likes_count || 0,
          comments_count: post.comments_count || 0,
          shares_count: post.shares_count || 0,
          created_at: post.created_at,
          updated_at: null,
        });
        useEntityStore.setState((state) => ({
          feedIds: [post.id, ...state.feedIds.filter((id) => id !== payload.tempId)],
          myPostIds: [post.id, ...state.myPostIds.filter((id) => id !== payload.tempId)],
        }));
      }
      return true;
    }

    case 'create_repost': {
      const { post, error } = await createRepost(payload.authorId, payload.originalPostId, payload.comment);
      if (error) return false;
      if (post && payload.tempId) {
        const store = useEntityStore.getState();
        store.removePost(payload.tempId);
        store.upsertPost({
          id: post.id,
          author_id: post.author_id,
          content: post.content,
          image_url: post.image_url,
          likes_count: post.likes_count || 0,
          comments_count: post.comments_count || 0,
          shares_count: post.shares_count || 0,
          created_at: post.created_at,
          updated_at: null,
        });
        useEntityStore.setState((state) => ({
          feedIds: [post.id, ...state.feedIds.filter((id) => id !== payload.tempId)],
          myPostIds: [post.id, ...state.myPostIds.filter((id) => id !== payload.tempId)],
        }));
      }
      return true;
    }

    case 'delete_post': {
      const { error } = await deletePost(payload.postId, payload.authorId);
      return !error;
    }

    case 'toggle_like': {
      const { error } = await toggleLike(payload.userId, payload.postId);
      return !error;
    }

    case 'create_comment': {
      const { error } = await createComment(payload.postId, payload.authorId, payload.content);
      return !error;
    }

    case 'follow': {
      const { error } = await followUser(payload.followerId, payload.followingId);
      return !error;
    }

    case 'unfollow': {
      const { error } = await unfollowUser(payload.followerId, payload.followingId);
      return !error;
    }

    case 'update_profile': {
      const { error } = await updateProfile(payload.userId, payload.updates);
      return !error;
    }

    default:
      return false;
  }
}

// --- Get pending mutation count (for UI indicators) ---

export function getPendingCount(): number {
  const db = getDatabase();
  const row = db.getFirstSync<{ count: number }>(
    'SELECT COUNT(*) as count FROM mutation_queue WHERE status = ?',
    ['pending']
  );
  return row?.count ?? 0;
}
