# Design Document: Offline-First Cache

## Overview

This design integrates the existing offline infrastructure (`database.ts`, `entityStore.ts`, `syncEngine.ts`, `mutationQueue.ts`) with the UI layer to deliver a stale-while-revalidate experience. The app shows cached data from SQLite immediately on launch, then syncs fresh data from Supabase in the background. When SQLite is unavailable, the app degrades gracefully to online-only mode.

The key architectural change is moving from "fetch on every mount" to "read from entityStore first, sync in background." The existing modules are already functional — this design focuses on wiring them into the app lifecycle and UI screens.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    _layout.tsx                           │
│  ┌─────────────────────────────────────────────────┐    │
│  │  Module-level: initDatabase()                   │    │
│  │  Module-level: entityStore.hydrate()            │    │
│  └─────────────────────────────────────────────────┘    │
│                         │                               │
│                         ▼                               │
│  ┌─────────────────────────────────────────────────┐    │
│  │  RootLayout component                           │    │
│  │  - Waits for isHydrated (with 2s timeout)       │    │
│  │  - Starts syncLoop on auth                      │    │
│  │  - Manages AppState for foreground/background   │    │
│  └─────────────────────────────────────────────────┘    │
│                         │                               │
│            ┌────────────┼────────────┐                  │
│            ▼            ▼            ▼                  │
│     Feed Screen   Profile Screen  Comments Screen       │
│     (tabs/index)  (tabs/profile)  (comments/[id])       │
│                   (profile/[id])                        │
└─────────────────────────────────────────────────────────┘

Data Flow (stale-while-revalidate):
1. Screen mounts → reads from entityStore (instant, cached)
2. Screen triggers background sync via syncEngine
3. syncEngine fetches from Supabase → updates entityStore + SQLite
4. Zustand subscription re-renders the screen with fresh data
```

## Components and Interfaces

### 1. Database Initialization (Module-Level)

**File:** `app/_layout.tsx`

The database must be initialized before any component renders. This is achieved by calling `initDatabase()` at module scope (top of `_layout.tsx`), outside any component or hook.

```typescript
import { initDatabase } from '../src/lib/database';
import { useEntityStore } from '../src/lib/entityStore';

// Module-level: runs before any component renders
initDatabase();
useEntityStore.getState().hydrate();
```

This ensures:
- SQLite tables are created (or noopDb is activated) before the first render
- Entity store is hydrated synchronously from SQLite cache
- If either fails, `isHydrated` is set to `true` anyway (graceful degradation)

### 2. Entity Store Hydration Guard

**File:** `app/_layout.tsx` (within `RootLayout`)

The layout waits for `isHydrated` before rendering children. A 2-second safety timeout ensures the app never gets stuck:

```typescript
function RootLayout() {
  const isHydrated = useEntityStore((s) => s.isHydrated);

  useEffect(() => {
    // Safety: force hydrated after 2s if something went wrong
    const timer = setTimeout(() => {
      if (!useEntityStore.getState().isHydrated) {
        useEntityStore.setState({ isHydrated: true });
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, []);

  if (!isHydrated) {
    return <CustomSplash />;
  }

  // ... rest of layout
}
```

### 3. Sync Loop Lifecycle Management

**File:** `app/_layout.tsx`

The sync loop starts when the user is authenticated and the app is in the foreground. It stops when the app goes to background.

```typescript
import { AppState } from 'react-native';
import { startSyncLoop, stopSyncLoop, fullSync } from '../src/lib/syncEngine';

function useSyncLifecycle(userId: string | undefined) {
  useEffect(() => {
    if (!userId) return;

    // Initial full sync
    fullSync(userId);
    startSyncLoop();

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        startSyncLoop();
      } else {
        stopSyncLoop();
      }
    });

    return () => {
      stopSyncLoop();
      subscription.remove();
    };
  }, [userId]);
}
```

### 4. Feed Screen Integration

**File:** `app/(tabs)/index.tsx`

The feed screen reads from `entityStore` first (cached posts), then triggers a background sync. The key change: replace the local `posts` state with a Zustand selector.

```typescript
import { useEntityStore } from '../../src/lib/entityStore';
import { syncFeed } from '../../src/lib/syncEngine';

export default function FeedScreen() {
  const isHydrated = useEntityStore((s) => s.isHydrated);
  const feedPosts = useEntityStore((s) => s.getFeedPosts());
  const { user } = useAuthStore();

  // Background sync on mount
  useEffect(() => {
    if (isHydrated && user?.id) {
      syncFeed(user.id);
    }
  }, [isHydrated, user?.id]);

  // Show skeleton only if not hydrated AND no cached posts
  const isLoading = !isHydrated && feedPosts.length === 0;

  // Map LocalPost[] to Post[] for rendering (add author info from profiles)
  const posts = useMemo(() => mapLocalPostsToViewPosts(feedPosts), [feedPosts]);

  // ... render posts
}
```

### 5. Profile Screen Integration

**File:** `app/(tabs)/profile.tsx` and `app/profile/[id].tsx`

Profile screens read from `entityStore` for cached profile data, then sync in background:

```typescript
import { useEntityStore } from '../../src/lib/entityStore';
import { syncProfile, syncUserPosts } from '../../src/lib/syncEngine';

export default function ProfileScreen() {
  const { user } = useAuthStore();
  const cachedProfile = useEntityStore((s) => s.getProfile(user?.id ?? ''));
  const cachedPosts = useEntityStore((s) => s.getMyPosts(user?.id ?? ''));

  // Background sync
  useEffect(() => {
    if (user?.id) {
      syncProfile(user.id);
      syncUserPosts(user.id);
    }
  }, [user?.id]);

  // Use cached data immediately, fresh data arrives via store update
  const displayProfile = cachedProfile ?? user;
  // ...
}
```

For `profile/[id].tsx`:

```typescript
export default function UserProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const cachedProfile = useEntityStore((s) => s.getProfile(id ?? ''));

  useEffect(() => {
    if (id) {
      syncProfile(id);
      syncUserPosts(id);
    }
  }, [id]);

  // Show cached profile immediately (no loading spinner if cached)
  const isLoading = !cachedProfile;
  // ...
}
```

### 6. Like State Integration

**File:** Feed and post components

Likes are read from `entityStore` instead of local component state:

```typescript
const isLiked = useEntityStore((s) => s.isLiked(userId, postId));

const handleToggleLike = (postId: string) => {
  queueMutation('toggle_like', { userId: user.id, postId });
};
```

### 7. Comments Caching

**File:** `app/comments/[id].tsx`

Comments follow the same stale-while-revalidate pattern. The `entityStore` needs a `comments` field (keyed by post_id):

```typescript
// In entityStore, add:
comments: Record<string, LocalComment[]>; // postId -> comments

// In comments screen:
const cachedComments = useEntityStore((s) => s.comments[postId] ?? []);

useEffect(() => {
  syncComments(postId); // fetches from Supabase, updates store + SQLite
}, [postId]);
```

### 8. Interfaces

#### entityStore additions

```typescript
interface EntityState {
  // Existing fields...
  comments: Record<string, LocalComment[]>;

  // New actions
  upsertComments: (postId: string, comments: LocalComment[]) => void;
  getComments: (postId: string) => LocalComment[];
}
```

#### syncEngine additions

```typescript
// New export
export async function syncComments(postId: string): Promise<void>;
```

#### Post View Model Mapping

A utility function maps `LocalPost` + cached profiles into the `Post` view type used by UI components:

```typescript
function mapLocalPostToViewPost(
  localPost: LocalPost,
  profiles: Record<string, LocalProfile>,
  userId: string,
  likes: Record<string, Set<string>>
): Post {
  const profile = profiles[localPost.author_id];
  return {
    id: localPost.id,
    authorId: localPost.author_id,
    authorName: profile?.display_name ?? 'User',
    authorUsername: profile?.username ?? 'user',
    authorEmoji: profile?.emoji ?? '😊',
    content: localPost.content,
    imageUrl: parseImageUrls(localPost.image_url)[0] ?? undefined,
    imageUrls: parseImageUrls(localPost.image_url),
    likesCount: localPost.likes_count,
    commentsCount: localPost.comments_count,
    sharesCount: localPost.shares_count,
    isLiked: likes[userId]?.has(localPost.id) ?? false,
    isBookmarked: false,
    createdAt: localPost.created_at,
  };
}
```

## Data Models

The existing SQLite schema (created in `database.ts`) already covers all needed tables:

| Table | Purpose |
|-------|---------|
| `posts` | Cached feed and user posts |
| `profiles` | Cached user profiles |
| `likes` | User's liked post IDs |
| `follows` | User's follow relationships |
| `comments` | Cached comments per post |
| `mutation_queue` | Pending offline mutations |
| `sync_meta` | Last sync timestamps |

No schema changes are needed. The `comments` table already exists in `initDatabase()`.

## Error Handling

### SQLite Failure at Startup

```
initDatabase() fails
  → dbFailed = true
  → getDatabase() returns noopDb
  → hydrate() catches error, sets isHydrated = true
  → App proceeds in online-only mode
```

### Network Failure During Sync

```
syncFeed() / syncProfile() throws
  → catch block logs warning
  → entityStore retains existing cached data
  → UI continues showing stale data
  → Next sync interval retries automatically
```

### Mutation Queue Failure

```
processQueue() encounters network error
  → Mutation stays as 'pending'
  → Loop breaks (stops processing further)
  → Next interval retries from the same mutation
  → After server-side permanent failure: status = 'failed'
```

### Hydration Timeout

```
hydrate() takes too long or hangs
  → 2-second timeout in _layout.tsx forces isHydrated = true
  → App renders with empty state
  → Background sync populates data
```

## Dependency Changes

### package.json

Add `expo-sqlite` dependency:

```json
{
  "dependencies": {
    "expo-sqlite": "~15.1.3"
  }
}
```

### app.json

Add `expo-sqlite` to plugins array:

```json
{
  "expo": {
    "plugins": [
      "expo-router",
      "expo-font",
      "./plugins/withFmtPatch",
      "expo-sqlite"
    ]
  }
}
```

## Testing Strategy

### Unit Tests (Example-Based)

- **Configuration checks**: Verify `expo-sqlite` is in `package.json` dependencies and `app.json` plugins
- **Hydration timeout**: Verify the 2-second safety timeout forces `isHydrated = true`
- **UI integration**: Verify feed screen renders cached posts when `isHydrated` is true
- **Sync lifecycle**: Verify `startSyncLoop`/`stopSyncLoop` respond to AppState changes
- **Mutation replay**: Verify `processQueue` marks completed mutations and replaces temp IDs

### Property Tests

- **Noop database safety**: All operations on noopDb return safe defaults without throwing
- **Hydration completeness**: `hydrate()` always sets `isHydrated = true` regardless of DB state
- **Cache round-trip**: Posts/profiles stored in SQLite are retrievable after hydration
- **Sync merge correctness**: Fresh data from server is persisted in both store and SQLite
- **Mutation queue ordering**: Pending mutations are processed in FIFO order
- **Optimistic update consistency**: `queueMutation` applies local changes AND enqueues for server
- **Like toggle idempotence**: Double-toggling a like returns to original state

### Integration Tests

- **End-to-end offline flow**: Create post offline → verify in queue → simulate network restore → verify synced
- **Graceful degradation**: Force SQLite failure → verify app operates in online-only mode
- **Background sync**: Verify sync loop starts/stops with app foreground/background transitions

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Noop database is side-effect free

*For any* database operation (execSync, runSync, getAllSync, getFirstSync) called on the noopDb, the operation SHALL return a safe default value (empty array, null, or zero-change result) and SHALL NOT throw an exception.

**Validates: Requirements 2.1, 10.3**

### Property 2: Hydration always completes

*For any* initial database state (including failure states, empty databases, and corrupted data), calling `hydrate()` SHALL result in `isHydrated` being set to `true`.

**Validates: Requirements 2.2, 2.5, 3.2, 3.3**

### Property 3: Hydration round-trip for posts

*For any* set of valid posts stored in the SQLite `posts` table, after calling `hydrate()`, the entityStore SHALL contain those posts accessible via `getFeedPosts()`.

**Validates: Requirements 3.1**

### Property 4: Sync merges posts into store and cache

*For any* set of fresh posts returned by the Supabase API, after `syncFeed()` completes, every post SHALL be present in both the entityStore's `posts` map and retrievable from the SQLite `posts` table.

**Validates: Requirements 4.3, 5.3**

### Property 5: Failed sync preserves existing cache

*For any* entityStore state containing cached posts, if `syncFeed()` or `syncProfile()` throws a network error, the entityStore SHALL retain all previously cached posts and profiles unchanged.

**Validates: Requirements 4.5, 5.5**

### Property 6: Optimistic mutation updates store and enqueues

*For any* valid mutation (create_post, delete_post, toggle_like, follow, unfollow, create_comment), calling `queueMutation(type, payload)` SHALL both apply the change to the entityStore immediately AND insert a record with status 'pending' into the mutation_queue table.

**Validates: Requirements 6.3, 6.4, 7.5, 9.1, 9.2**

### Property 7: Mutation queue processes in FIFO order

*For any* sequence of pending mutations in the queue, `processQueue()` SHALL process them in ascending `id` order (which corresponds to insertion order).

**Validates: Requirements 9.3**

### Property 8: Failed mutations are retained with failed status

*For any* mutation that receives a permanent server error during `processQueue()`, the mutation record SHALL have its status set to 'failed' and SHALL NOT be deleted from the queue.

**Validates: Requirements 9.5**

### Property 9: Sync loop resilience

*For any* error thrown during a sync cycle (processQueue or syncFeed), the sync loop SHALL NOT terminate — it SHALL catch the error and continue scheduling the next interval.

**Validates: Requirements 8.5**

### Property 10: Like toggle is its own inverse

*For any* user and post, calling `queueMutation('toggle_like', {userId, postId})` twice SHALL return the entityStore's like state for that (user, post) pair to its original value.

**Validates: Requirements 6.3**
