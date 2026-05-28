# Requirements Document

## Introduction

This feature replaces the existing SQLite-based persistence layer (`database.ts`, `entityStore.ts`) with a pure AsyncStorage implementation for offline-first caching and mutation queuing. The app uses a repository pattern where UI screens read exclusively from the local cache (AsyncStorage-backed Zustand stores), and a background sync layer reconciles with Supabase when connectivity is available. Connectivity is detected via fetch-based health checks (no native NetInfo module). Posts created offline (including those with images) are queued and displayed with a pending indicator until synced. All five main screens (Feed, Profile, Other Profile, Create, Messages) are integrated simultaneously.

## Glossary

- **Cache_Layer**: The AsyncStorage-backed persistence module that stores serialized entities (posts, profiles, conversations, messages, likes, follows) as JSON key-value pairs
- **Sync_Engine**: The background service that detects connectivity and reconciles local mutations with the Supabase remote database
- **Mutation_Queue**: An AsyncStorage-persisted ordered list of pending write operations (create post, like, comment, follow, send message) awaiting server sync
- **Connectivity_Monitor**: A fetch-based polling mechanism that determines online/offline status by issuing lightweight HTTP requests to a known endpoint
- **Entity_Store**: The Zustand in-memory store that holds normalized entities hydrated from the Cache_Layer, serving as the single source of truth for UI rendering
- **Pending_Indicator**: A visual marker displayed on posts or messages that have been created locally but not yet confirmed by the server
- **Repository**: The data access pattern where UI components read only from the Entity_Store (local cache) and never directly from the network

## Requirements

### Requirement 1: AsyncStorage Cache Layer

**User Story:** As a user, I want the app to load instantly from local data, so that I can browse content without waiting for network responses.

#### Acceptance Criteria

1. THE Cache_Layer SHALL persist feed posts, user profiles, conversations, messages, likes, and follows as JSON strings in AsyncStorage using namespaced keys.
2. WHEN the app launches, THE Entity_Store SHALL hydrate its in-memory state from the Cache_Layer before rendering any screen.
3. WHEN fresh data is fetched from Supabase, THE Cache_Layer SHALL overwrite the corresponding cached entries with the new data.
4. THE Cache_Layer SHALL store each entity collection under a deterministic key prefix (e.g., `@san:feed`, `@san:profile:{id}`, `@san:conversations`).
5. IF an AsyncStorage read or write operation throws an error, THEN THE Cache_Layer SHALL catch the error, log a warning, and continue operation without crashing the app.
6. THE Cache_Layer SHALL limit stored feed posts to the most recent 200 entries to prevent unbounded storage growth.

### Requirement 2: Remove SQLite Dependency

**User Story:** As a developer, I want to eliminate the SQLite native module dependency, so that the app builds reliably without native linking issues.

#### Acceptance Criteria

1. THE Entity_Store SHALL use the Cache_Layer (AsyncStorage) for all read and write persistence operations instead of SQLite.
2. THE Entity_Store SHALL remove all imports and references to `expo-sqlite` and the `database.ts` module.
3. THE Entity_Store SHALL provide the same public API surface (upsertPost, upsertPosts, upsertProfile, removePost, setLike, removeLike, setFollow, removeFollow) backed by AsyncStorage.
4. WHEN the Entity_Store hydrates, THE Entity_Store SHALL read from AsyncStorage asynchronously and set `isHydrated` to true upon completion.
5. IF hydration from AsyncStorage fails, THEN THE Entity_Store SHALL set `isHydrated` to true with empty state so the app can proceed to fetch from the network.

### Requirement 3: Fetch-Based Connectivity Detection

**User Story:** As a user, I want the app to detect when I am offline, so that it can queue my actions and sync them when connectivity returns.

#### Acceptance Criteria

1. THE Connectivity_Monitor SHALL determine online status by performing a fetch request to the Supabase health endpoint (`/rest/v1/`) with a timeout of 5 seconds.
2. THE Connectivity_Monitor SHALL poll connectivity status at an interval of 30 seconds while the app is in the foreground.
3. WHEN the Connectivity_Monitor detects a transition from offline to online, THE Sync_Engine SHALL begin processing the Mutation_Queue.
4. WHEN the Connectivity_Monitor detects a transition from online to offline, THE Sync_Engine SHALL pause queue processing and retain all pending mutations.
5. THE Connectivity_Monitor SHALL expose a boolean `isOnline` state readable by any component via a Zustand store.
6. THE Connectivity_Monitor SHALL NOT use any native module (NetInfo or equivalent) for connectivity detection.

### Requirement 4: Offline Mutation Queue

**User Story:** As a user, I want my actions (posts, likes, messages) to be saved locally when offline, so that they are sent to the server when I reconnect.

#### Acceptance Criteria

1. THE Mutation_Queue SHALL persist queued mutations in AsyncStorage under the key `@san:mutation_queue` as a JSON array.
2. WHEN a write operation (create post, toggle like, create comment, follow/unfollow, send message) is performed while offline, THE Mutation_Queue SHALL append the operation with a type identifier, payload, timestamp, and status of `pending`.
3. WHEN the Sync_Engine processes the queue, THE Sync_Engine SHALL execute mutations in FIFO order (oldest first).
4. WHEN a mutation is successfully synced to Supabase, THE Sync_Engine SHALL remove that mutation from the Mutation_Queue and update the Entity_Store with the server-confirmed data.
5. IF a mutation fails with a non-retryable error (4xx status), THEN THE Sync_Engine SHALL mark the mutation as `failed` and skip to the next item.
6. IF a mutation fails with a retryable error (network error, 5xx status), THEN THE Sync_Engine SHALL retain the mutation in the queue and retry on the next sync cycle.
7. THE Mutation_Queue SHALL assign a local temporary ID (prefixed with `temp_`) to locally created entities so the UI can reference them before server confirmation.

### Requirement 5: Offline Post Creation with Image Queuing

**User Story:** As a user, I want to create posts with images while offline, so that they are published automatically when I reconnect.

#### Acceptance Criteria

1. WHEN the user creates a post while offline, THE Create screen SHALL save the post content and local image URIs to the Mutation_Queue.
2. WHEN a post is queued offline, THE Entity_Store SHALL insert a local post entity with a temporary ID and the `pending` status so it appears in the feed and profile immediately.
3. WHILE a post has `pending` status, THE Feed screen and Profile screen SHALL display the Pending_Indicator on that post.
4. WHEN connectivity is restored, THE Sync_Engine SHALL upload queued images to Supabase Storage and then create the post with the resulting public URLs.
5. WHEN the server confirms the post creation, THE Entity_Store SHALL replace the temporary post ID with the server-assigned ID and remove the Pending_Indicator.
6. IF image upload fails after 3 retry attempts, THEN THE Sync_Engine SHALL mark the mutation as `failed` and THE Entity_Store SHALL display an error indicator on the post.

### Requirement 6: Repository Pattern — UI Reads from Cache Only

**User Story:** As a user, I want the app to feel fast and responsive, so that I never see blank screens while data loads from the network.

#### Acceptance Criteria

1. THE Feed screen SHALL render posts exclusively from the Entity_Store without awaiting any network call.
2. THE Profile screen SHALL render the user's posts and profile data exclusively from the Entity_Store.
3. THE Other Profile screen SHALL render the viewed user's profile and posts from the Entity_Store, falling back to a loading state only if no cached data exists for that user.
4. THE Messages screen SHALL render conversations and messages from the Entity_Store.
5. WHEN a screen mounts, THE screen SHALL trigger a background network fetch that updates the Entity_Store and Cache_Layer upon completion, without blocking the initial render.
6. WHILE a background fetch is in progress, THE screen SHALL display a subtle refresh indicator (pull-to-refresh spinner or inline indicator) without replacing the cached content.

### Requirement 7: App Stability and Crash Prevention

**User Story:** As a user, I want the app to remain stable regardless of network conditions or storage errors, so that I never experience a crash.

#### Acceptance Criteria

1. THE Cache_Layer SHALL wrap every AsyncStorage operation in a try-catch block and return a safe default value on failure.
2. THE Sync_Engine SHALL wrap every network operation in a try-catch block and handle errors gracefully without propagating exceptions to the UI layer.
3. THE Entity_Store SHALL validate data integrity (check for null, undefined, or malformed JSON) before updating in-memory state.
4. IF AsyncStorage returns corrupted or unparseable data, THEN THE Cache_Layer SHALL discard the corrupted entry, log a warning, and return an empty default.
5. THE Connectivity_Monitor SHALL catch all fetch errors (including AbortError from timeout) and treat them as an offline signal without throwing.
6. WHILE the Mutation_Queue contains more than 50 pending items, THE Sync_Engine SHALL process items in batches of 10 to prevent memory pressure.

### Requirement 8: All Five Screens Integration

**User Story:** As a user, I want offline support across all screens simultaneously, so that the entire app works consistently whether online or offline.

#### Acceptance Criteria

1. THE Feed screen SHALL display cached posts on mount and update them in the background when online.
2. THE Profile screen SHALL display the current user's cached posts and profile on mount and sync in the background.
3. THE Other Profile screen SHALL display a cached version of any previously viewed profile and sync fresh data in the background when online.
4. THE Create screen SHALL allow post creation regardless of connectivity status, queuing the post if offline.
5. THE Messages screen SHALL display cached conversations on mount and queue new messages for sync if offline.
6. WHEN the Sync_Engine completes a background sync, THE Entity_Store SHALL notify all mounted screens of updated data via Zustand reactivity.
