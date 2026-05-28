# Design Document: Async Storage Offline

## Overview

This design replaces the broken SQLite-based persistence layer (`database.ts`, `entityStore.ts`, `syncEngine.ts`, `mutationQueue.ts`) with a simple, stable AsyncStorage-only implementation. The architecture follows a strict repository pattern: UI reads from Zustand stores, stores hydrate from AsyncStorage on startup, and a background sync service reconciles with Supabase when online.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  UI Screens (Feed, Profile, Create, Messages)       │
│  Read from Zustand store only                       │
└──────────────────────┬──────────────────────────────┘
                       │ subscribe
┌──────────────────────▼──────────────────────────────┐
│  Entity Store (Zustand)                             │
│  In-memory normalized state                         │
│  Hydrates from cache on startup                     │
└──────┬───────────────────────────────────┬──────────┘
       │ read/write                        │ optimistic update
┌──────▼──────────┐              ┌─────────▼──────────┐
│  Cache Service  │              │  Offline Queue     │
│  AsyncStorage   │              │  AsyncStorage      │
│  @san:* keys    │              │  @san:mutations    │
└─────────────────┘              └─────────┬──────────┘
                                           │ process on reconnect
┌──────────────────────────────────────────▼──────────┐
│  Sync Service                                       │
│  Fetches from Supabase → updates cache + store      │
│  Processes offline queue → calls Supabase API       │
└──────────────────────┬──────────────────────────────┘
                       │ polls every 30s
┌──────────────────────▼──────────────────────────────┐
│  Connectivity Monitor                               │
│  fetch-based ping to Supabase /rest/v1/             │
└─────────────────────────────────────────────────────┘
```

## Technology Stack

- **Runtime**: React Native (Expo SDK 54)
- **State Management**: Zustand 5.x
- **Persistence**: @react-native-async-storage/async-storage 2.2.0
- **Backend**: Supabase (existing client in `src/lib/supabase.ts`)
- **Language**: TypeScript

## File Structure

All new files live in `src/services/`. The broken files in `src/lib/` (`database.ts`, `entityStore.ts`, `syncEngine.ts`, `mutationQueue.ts`) are replaced. The existing `src/lib/cache.ts` is also replaced.

```
src/services/
├── cacheService.ts        # AsyncStorage read/write with try-catch
├── entityStore.ts         # Zustand store, hydrates from cache
├── syncService.ts         # Fetches from Supabase, updates cache + store
├── offlineQueue.ts        # Persists mutations, processes on reconnect
└── connectivityMonitor.ts # Fetch ping every 30s, exposes isOnline
```

**Total: 5 files** replacing 5 broken files (database.ts, entityStore.ts, syncEngine.ts, mutationQueue.ts, cache.ts).

## Components and Interfaces

### 1. Cache Service (`src/services/cacheService.ts`)

The simplest layer. Wraps AsyncStorage with try-catch and JSON serialization.

**Responsibilities:**
- Read/write JSON entities to AsyncStorage
- Namespace all keys with `@san:` prefix
- Enforce feed size limit (max 200 posts)
- Return safe defaults on any error

**Key Constants:**
```typescript
const KEYS = {
  feed: '@san:feed',
  profile: (id: string) => `@san:profile:${id}`,
  conversations: '@san:conversations',
  messages: (convId: string) => `@san:messages:${convId}`,
  likes: (userId: string) => `@san:likes:${userId}`,
  follows: (userId: string) => `@san:follows:${userId}`,
  mutations: '@san:mutation_queue',
} as const;

const MAX_FEED_POSTS = 200;
```

**Interface:**
```typescript
// Generic read/write
async function cacheGet<T>(key: string, fallback: T): Promise<T>;
async function cacheSet(key: string, value: unknown): Promise<void>;
async function cacheRemove(key: string): Promise<void>;

// Entity-specific helpers
async function cacheFeed(posts: LocalPost[]): Promise<void>;
async function getCachedFeed(): Promise<LocalPost[]>;
async function cacheProfile(id: string, profile: LocalProfile): Promise<void>;
async function getCachedProfile(id: string): Promise<LocalProfile | null>;
async function cacheConversations(conversations: LocalConversation[]): Promise<void>;
async function getCachedConversations(): Promise<LocalConversation[]>;
async function cacheMessages(convId: string, messages: LocalMessage[]): Promise<void>;
async function getCachedMessages(convId: string): Promise<LocalMessage[]>;
async function cacheLikes(userId: string, postIds: string[]): Promise<void>;
async function getCachedLikes(userId: string): Promise<string[]>;
async function cacheFollows(userId: string, followingIds: string[]): Promise<void>;
async function getCachedFollows(userId: string): Promise<string[]>;
```

**Error Handling Pattern:**
```typescript
async function cacheGet<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw === null) return fallback;
    const parsed = JSON.parse(raw);
    if (parsed === null || parsed === undefined) return fallback;
    return parsed as T;
  } catch (e) {
    console.warn('[CacheService] Read failed for key:', key, e);
    return fallback;
  }
}

async function cacheSet(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn('[CacheService] Write failed for key:', key, e);
  }
}
```

### 2. Entity Store (`src/services/entityStore.ts`)

A Zustand store that holds normalized entities in memory. Hydrates from the cache service on startup. All UI reads come from here.

**State Shape:**
```typescript
interface EntityState {
  // Data
  posts: Record<string, LocalPost>;
  profiles: Record<string, LocalProfile>;
  likes: Record<string, string[]>;       // userId -> postId[]
  follows: Record<string, string[]>;     // userId -> followingId[]
  conversations: LocalConversation[];
  feedIds: string[];
  myPostIds: string[];

  // Status
  isHydrated: boolean;

  // Actions
  hydrate: () => Promise<void>;
  upsertPost: (post: LocalPost) => void;
  upsertPosts: (posts: LocalPost[]) => void;
  upsertProfile: (profile: LocalProfile) => void;
  removePost: (id: string) => void;
  setLike: (userId: string, postId: string) => void;
  removeLike: (userId: string, postId: string) => void;
  isLiked: (userId: string, postId: string) => boolean;
  setFollow: (followerId: string, followingId: string) => void;
  removeFollow: (followerId: string, followingId: string) => void;
  isFollowing: (followerId: string, followingId: string) => boolean;
  setFeedIds: (ids: string[]) => void;
  setMyPostIds: (ids: string[]) => void;
  setConversations: (convs: LocalConversation[]) => void;
  replaceTempPost: (tempId: string, realPost: LocalPost) => void;
}
```

**Hydration Flow:**
```typescript
hydrate: async () => {
  try {
    const [feed, conversations] = await Promise.all([
      getCachedFeed(),
      getCachedConversations(),
    ]);
    const postsMap: Record<string, LocalPost> = {};
    const feedIds: string[] = [];
    for (const post of feed) {
      postsMap[post.id] = post;
      feedIds.push(post.id);
    }
    set({ posts: postsMap, feedIds, conversations, isHydrated: true });
  } catch (e) {
    console.warn('[EntityStore] Hydration failed:', e);
    set({ isHydrated: true }); // Proceed with empty state
  }
}
```

**Data Integrity Validation:**
```typescript
function isValidPost(data: unknown): data is LocalPost {
  if (!data || typeof data !== 'object') return false;
  const d = data as any;
  return typeof d.id === 'string' && typeof d.author_id === 'string'
    && typeof d.content === 'string' && typeof d.created_at === 'string';
}

function isValidProfile(data: unknown): data is LocalProfile {
  if (!data || typeof data !== 'object') return false;
  const d = data as any;
  return typeof d.id === 'string' && typeof d.username === 'string'
    && typeof d.display_name === 'string';
}
```

### 3. Sync Service (`src/services/syncService.ts`)

Fetches fresh data from Supabase and updates both the cache and the entity store. Called on app start (after hydration) and on pull-to-refresh.

**Interface:**
```typescript
async function syncFeed(userId?: string): Promise<void>;
async function syncProfile(profileId: string): Promise<void>;
async function syncProfiles(): Promise<void>;
async function syncLikes(userId: string): Promise<void>;
async function syncFollows(userId: string): Promise<void>;
async function syncUserPosts(userId: string): Promise<void>;
async function syncConversations(userId: string): Promise<void>;
async function syncMessages(conversationId: string): Promise<void>;
async function fullSync(userId: string): Promise<void>;
```

**Sync Pattern (all functions follow this):**
```typescript
async function syncFeed(userId?: string): Promise<void> {
  try {
    const { posts, error } = await getPosts(100, 0);
    if (error || !posts.length) return;

    const localPosts: LocalPost[] = posts.map(mapDbPostToLocal);
    const feedIds = localPosts.map(p => p.id);

    // Update store (triggers UI re-render via Zustand)
    const store = useEntityStore.getState();
    store.upsertPosts(localPosts);
    store.setFeedIds(feedIds);

    // Persist to cache (background, non-blocking)
    await cacheFeed(localPosts);
  } catch (e) {
    console.warn('[SyncService] syncFeed failed:', e);
  }
}
```

### 4. Offline Queue (`src/services/offlineQueue.ts`)

Persists pending mutations in AsyncStorage. Processes them in FIFO order when connectivity is restored.

**Mutation Record Shape:**
```typescript
interface MutationRecord {
  id: string;           // UUID for deduplication
  type: MutationType;
  payload: any;
  timestamp: string;    // ISO string
  status: 'pending' | 'failed';
  retryCount: number;
}

type MutationType =
  | 'create_post'
  | 'delete_post'
  | 'toggle_like'
  | 'create_comment'
  | 'follow'
  | 'unfollow'
  | 'update_profile'
  | 'send_message'
  | 'create_repost';
```

**Interface:**
```typescript
// Queue a mutation (applies optimistic update + persists to queue)
async function queueMutation(type: MutationType, payload: any): Promise<void>;

// Process pending mutations (called when online)
async function processQueue(): Promise<void>;

// Get current queue (for UI indicators)
async function getQueueLength(): Promise<number>;
async function getQueue(): Promise<MutationRecord[]>;
```

**Queue Processing Logic:**
```typescript
async function processQueue(): Promise<void> {
  const queue = await getQueue();
  const pending = queue.filter(m => m.status === 'pending');
  if (pending.length === 0) return;

  // Batch size: 10 if queue > 50, otherwise process all
  const batchSize = pending.length > 50 ? 10 : pending.length;
  const batch = pending.slice(0, batchSize);

  for (const mutation of batch) {
    try {
      const result = await sendToServer(mutation);
      if (result.success) {
        await removeMutation(mutation.id);
        await handleSyncSuccess(mutation);
      } else if (result.retryable) {
        // Leave in queue for next cycle
        break;
      } else {
        // Non-retryable (4xx) — mark as failed
        await markFailed(mutation.id);
      }
    } catch (e) {
      // Network error — stop processing, retry next cycle
      break;
    }
  }
}
```

**Temp ID Generation:**
```typescript
function generateTempId(): string {
  return `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
```

**Optimistic Update on Queue:**
```typescript
async function queueMutation(type: MutationType, payload: any): Promise<void> {
  const mutation: MutationRecord = {
    id: generateTempId(),
    type,
    payload,
    timestamp: new Date().toISOString(),
    status: 'pending',
    retryCount: 0,
  };

  // 1. Apply optimistic update to entity store
  applyOptimisticUpdate(type, payload);

  // 2. Persist mutation to AsyncStorage queue
  const queue = await getQueue();
  queue.push(mutation);
  await cacheSet(KEYS.mutations, queue);
}
```

**Image Upload Retry (for create_post with images):**
```typescript
const MAX_IMAGE_RETRIES = 3;

async function uploadImageWithRetry(imageUri: string): Promise<string | null> {
  for (let attempt = 0; attempt < MAX_IMAGE_RETRIES; attempt++) {
    const { url, error } = await uploadPostImage(imageUri);
    if (url) return url;
    if (attempt < MAX_IMAGE_RETRIES - 1) {
      await delay(1000 * (attempt + 1)); // Backoff
    }
  }
  return null; // All retries failed
}
```

### 5. Connectivity Monitor (`src/services/connectivityMonitor.ts`)

A simple fetch-based ping that polls every 30 seconds. Exposes `isOnline` via a Zustand store slice.

**Interface:**
```typescript
interface ConnectivityState {
  isOnline: boolean;
  lastChecked: string | null;
  start: () => void;
  stop: () => void;
  checkNow: () => Promise<boolean>;
}

const useConnectivityStore = create<ConnectivityState>(...);
```

**Implementation:**
```typescript
const PING_URL = 'https://ycwadqglcykcpucembjn.supabase.co/rest/v1/';
const PING_TIMEOUT = 5000;
const POLL_INTERVAL = 30000;

let intervalId: ReturnType<typeof setInterval> | null = null;

async function checkConnectivity(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PING_TIMEOUT);
    const response = await fetch(PING_URL, {
      method: 'HEAD',
      signal: controller.signal,
      headers: { 'apikey': SUPABASE_ANON_KEY },
    });
    clearTimeout(timeoutId);
    return response.ok;
  } catch (e) {
    // Any error (AbortError, TypeError, etc.) = offline
    return false;
  }
}
```

**Transition Detection:**
```typescript
start: () => {
  if (intervalId) return;
  // Check immediately
  checkConnectivity().then(online => {
    const prev = get().isOnline;
    set({ isOnline: online, lastChecked: new Date().toISOString() });
    if (!prev && online) {
      // Transition: offline → online
      processQueue();
    }
  });
  // Poll every 30s
  intervalId = setInterval(async () => {
    const prev = get().isOnline;
    const online = await checkConnectivity();
    set({ isOnline: online, lastChecked: new Date().toISOString() });
    if (!prev && online) {
      processQueue();
    }
  }, POLL_INTERVAL);
}
```

## Data Models

### LocalPost
```typescript
interface LocalPost {
  id: string;              // Server UUID or temp_* for offline-created
  author_id: string;
  content: string;
  image_url: string | null;
  likes_count: number;
  comments_count: number;
  shares_count: number;
  created_at: string;
  status?: 'synced' | 'pending' | 'failed';  // For pending indicator
  localImageUris?: string[];                   // For offline image posts
}
```

### LocalProfile
```typescript
interface LocalProfile {
  id: string;
  username: string;
  display_name: string;
  emoji: string;
  bio: string;
  banner_url: string | null;
  links: string | null;       // JSON string of link array
  created_at: string | null;
  updated_at: string | null;
}
```

### LocalConversation
```typescript
interface LocalConversation {
  id: string;
  participantId: string;
  participantName: string;
  participantUsername: string;
  participantEmoji: string;
  lastMessage?: string;
  lastMessageAt?: string;
}
```

### LocalMessage
```typescript
interface LocalMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  text: string;
  created_at: string;
  status?: 'synced' | 'pending' | 'failed';
}
```

## Integration Points

### App Startup (`app/_layout.tsx`)

The startup sequence:
1. Fonts load
2. `useEntityStore.getState().hydrate()` — reads from AsyncStorage
3. `useConnectivityStore.getState().start()` — begins polling
4. Once `isHydrated === true`, render screens
5. Each screen triggers `syncService.syncX()` in a `useEffect`

### Screen Integration Pattern

Each screen follows the same pattern:
```typescript
export default function FeedScreen() {
  const { posts, feedIds, isHydrated } = useEntityStore();
  const { isOnline } = useConnectivityStore();

  useEffect(() => {
    if (isHydrated && isOnline) {
      syncFeed(userId); // Background, non-blocking
    }
  }, [isHydrated, isOnline]);

  // Render from store immediately — no loading state needed
  const feedPosts = feedIds.map(id => posts[id]).filter(Boolean);
  return <FlatList data={feedPosts} ... />;
}
```

### Offline Write Pattern

When a user performs a write action (create post, like, follow, etc.):
```typescript
async function handleCreatePost(content: string, imageUri?: string) {
  const { isOnline } = useConnectivityStore.getState();
  const tempId = generateTempId();

  if (isOnline) {
    // Try direct API call
    const { post, error } = await createPost(userId, content, imageUrl);
    if (!error && post) {
      // Success — update store with server data
      store.upsertPost(mapDbPostToLocal(post));
      return;
    }
  }

  // Offline or API failed — queue it
  await queueMutation('create_post', {
    tempId,
    authorId: userId,
    content,
    imageUris: imageUri ? [imageUri] : [],
  });
}
```

### Supabase API Integration

The sync service imports directly from the existing `src/lib/supabase.ts`:
- `getPosts()` — feed sync
- `getProfile()` / `getProfiles()` — profile sync
- `getConversations()` / `getMessages()` — messages sync
- `createPost()` / `deletePost()` / `toggleLike()` etc. — mutation execution
- `uploadPostImage()` — image upload during queue processing

No changes to `supabase.ts` are required.

## Error Handling

| Layer | Error Type | Handling |
|-------|-----------|----------|
| Cache Service | AsyncStorage throws | try-catch, return fallback, log warning |
| Entity Store | Corrupted cache data | Validate before insert, discard invalid |
| Sync Service | Network error | Swallow, log warning, UI shows stale data |
| Offline Queue | 4xx from server | Mark mutation as `failed`, skip |
| Offline Queue | 5xx / network error | Retain as `pending`, retry next cycle |
| Connectivity | fetch throws/times out | Set `isOnline = false`, no throw |
| Image Upload | 3 retries exhausted | Mark mutation `failed`, show error indicator |

## Migration Path

1. Delete `src/lib/database.ts`, `src/lib/entityStore.ts`, `src/lib/syncEngine.ts`, `src/lib/mutationQueue.ts`, `src/lib/cache.ts`
2. Create the 5 new files in `src/services/`
3. Update `src/store/index.ts` to re-export from `src/services/entityStore.ts`
4. Update `app/_layout.tsx` to call `hydrate()` and `start()` on app launch
5. Update screen files to use the new sync service functions
6. Remove `expo-sqlite` from `package.json` (if present)

## Testing Strategy

- **Unit tests**: Jest with mocked AsyncStorage for cache service, entity store, and offline queue logic
- **Property tests**: fast-check (100+ iterations) for round-trip properties, error resilience, and queue ordering
- **Integration tests**: Verify screen-level behavior with mocked Supabase responses
- **Test runner**: jest-expo (already configured in package.json)
- **Mocking**: AsyncStorage mocked via `@react-native-async-storage/async-storage/jest/async-storage-mock`

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Cache round-trip preservation

*For any* valid entity (post, profile, conversation, message, likes array, or follows array), writing it to the cache service and then reading it back SHALL produce a value equal to the original entity.

**Validates: Requirements 1.1, 1.3**

### Property 2: Cache key determinism

*For any* entity type and identifier string, the cache key generated by the cache service SHALL always produce the same string, and SHALL match the pattern `@san:{type}` or `@san:{type}:{id}`.

**Validates: Requirements 1.4**

### Property 3: Cache error resilience

*For any* AsyncStorage operation that throws an error (read or write), the cache service SHALL not propagate the exception and SHALL return the specified fallback value for reads.

**Validates: Requirements 1.5, 7.1, 7.4**

### Property 4: Cache feed size limit

*For any* feed array with more than 200 posts, after writing to the cache and reading back, the result SHALL contain at most 200 posts, and those posts SHALL be the 200 most recent by `created_at`.

**Validates: Requirements 1.6**

### Property 5: Hydration correctness

*For any* cache state (empty, populated with valid data, or corrupted), after `hydrate()` resolves, the entity store SHALL have `isHydrated === true`. If the cache contained valid data, the store SHALL contain that data. If the cache was empty or corrupted, the store SHALL have empty collections.

**Validates: Requirements 1.2, 2.4, 2.5**

### Property 6: Entity store CRUD consistency

*For any* valid entity, calling `upsertPost(entity)` followed by reading `posts[entity.id]` SHALL return the entity. Calling `removePost(id)` SHALL result in `posts[id]` being undefined. The same pattern applies to profiles, likes, and follows.

**Validates: Requirements 2.3**

### Property 7: Connectivity detection correctness

*For any* fetch response (success, timeout via AbortError, TypeError, or any other error), the connectivity monitor SHALL set `isOnline` to `true` only when the fetch succeeds with an OK status, and `false` for all error cases, without throwing an exception.

**Validates: Requirements 3.1, 7.5**

### Property 8: Offline-to-online triggers queue processing

*For any* state transition where `isOnline` changes from `false` to `true`, the connectivity monitor SHALL invoke `processQueue()`. When `isOnline` changes from `true` to `false`, pending mutations SHALL remain in the queue unchanged.

**Validates: Requirements 3.3, 3.4**

### Property 9: Mutation queue persistence round-trip

*For any* sequence of mutations queued via `queueMutation()`, reading the queue from AsyncStorage SHALL return all queued mutations in insertion order, each containing a valid `type`, `payload`, `timestamp`, and `status` of `'pending'`.

**Validates: Requirements 4.1, 4.2**

### Property 10: FIFO queue processing order

*For any* queue containing multiple pending mutations with different timestamps, `processQueue()` SHALL attempt to send them to the server in order from oldest timestamp to newest.

**Validates: Requirements 4.3**

### Property 11: Successful sync reconciliation

*For any* mutation that the server confirms successfully, that mutation SHALL be removed from the persisted queue. If the mutation created an entity with a temp ID, the entity store SHALL replace the temp ID entry with the server-assigned ID entry.

**Validates: Requirements 4.4, 5.5**

### Property 12: Error classification in queue processing

*For any* mutation that receives a 4xx HTTP response, the queue SHALL mark it as `'failed'` and continue processing the next item. *For any* mutation that receives a 5xx response or network error, the queue SHALL retain it as `'pending'` and stop processing the current batch.

**Validates: Requirements 4.5, 4.6**

### Property 13: Offline entity creation with temp ID

*For any* entity created while offline via `queueMutation()`, the entity store SHALL contain that entity with an ID prefixed by `temp_` and a status of `'pending'`.

**Validates: Requirements 4.7, 5.2**

### Property 14: Batch processing under pressure

*For any* mutation queue containing more than 50 pending items, a single invocation of `processQueue()` SHALL process at most 10 items before stopping.

**Validates: Requirements 7.6**

### Property 15: Data integrity validation

*For any* data read from the cache that does not conform to the expected entity shape (missing required fields, wrong types, null where not allowed), the entity store SHALL reject it and not insert it into in-memory state.

**Validates: Requirements 7.3**

### Property 16: Sync engine error containment

*For any* network error thrown during a sync operation (syncFeed, syncProfile, syncLikes, etc.), the sync service SHALL catch the error and not propagate it to the calling UI component.

**Validates: Requirements 7.2**
