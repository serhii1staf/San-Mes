# Requirements Document

## Introduction

This feature enables offline-first caching for the San social app using a cache-first with stale-while-revalidate strategy. The app displays cached data from SQLite immediately on launch, then fetches fresh data from Supabase in the background and updates the UI when the response arrives. The existing offline infrastructure (entityStore.ts, syncEngine.ts, mutationQueue.ts, database.ts) is reused and fixed rather than rewritten. The app must work gracefully when SQLite is unavailable, falling back to online-only mode.

## Glossary

- **App**: The San social mobile application built with Expo SDK 54 and React Native 0.81
- **Cache_Layer**: The local SQLite database accessed via expo-sqlite that persists entities for offline use
- **Entity_Store**: The Zustand-based in-memory store (entityStore.ts) that holds posts, profiles, likes, and follows loaded from Cache_Layer
- **Sync_Engine**: The background synchronization module (syncEngine.ts) that fetches fresh data from Supabase and updates Entity_Store and Cache_Layer
- **Mutation_Queue**: The offline mutation queue (mutationQueue.ts) that enqueues write operations locally and replays them to Supabase when connectivity is available
- **Noop_Database**: The fallback no-operation database object returned when expo-sqlite is unavailable, ensuring the app does not crash
- **Hydration**: The process of loading cached entities from Cache_Layer into Entity_Store at app startup
- **Stale_While_Revalidate**: A caching strategy where cached data is shown immediately and replaced with fresh server data once available
- **Feed_Screen**: The main tab screen displaying a list of posts
- **Profile_Screen**: The screen displaying a user's profile and their posts

## Requirements

### Requirement 1: SQLite Dependency Configuration

**User Story:** As a developer, I want expo-sqlite properly configured in both package.json and app.json plugins, so that the native module is available at runtime on all platforms.

#### Acceptance Criteria

1. THE App SHALL include expo-sqlite as a dependency in package.json
2. THE App SHALL include "expo-sqlite" in the plugins array of app.json
3. WHEN the App is built, THE App SHALL bundle the expo-sqlite native module for iOS and Android platforms

### Requirement 2: Graceful Degradation on SQLite Failure

**User Story:** As a user, I want the app to remain functional even if the local database fails to initialize, so that I can still use the app in online-only mode.

#### Acceptance Criteria

1. IF expo-sqlite fails to load or initialize, THEN THE Cache_Layer SHALL return the Noop_Database for all database operations
2. IF expo-sqlite fails to load or initialize, THEN THE Entity_Store SHALL set isHydrated to true within 2 seconds of app launch
3. WHILE the Noop_Database is active, THE App SHALL operate in online-only mode by fetching data directly from Supabase
4. IF expo-sqlite fails to load or initialize, THEN THE App SHALL log a warning and continue without crashing
5. THE App SHALL not display an infinite skeleton loader regardless of SQLite initialization status

### Requirement 3: Cache Hydration at Startup

**User Story:** As a user, I want to see my previously loaded content immediately when I open the app, so that I have a fast and responsive experience.

#### Acceptance Criteria

1. WHEN the App launches and Cache_Layer is available, THE Entity_Store SHALL load cached posts, profiles, likes, and follows from Cache_Layer into memory
2. WHEN Hydration completes successfully, THE Entity_Store SHALL set isHydrated to true
3. IF Hydration fails for any reason, THEN THE Entity_Store SHALL set isHydrated to true and proceed with empty state
4. THE Entity_Store SHALL complete Hydration within 2 seconds of app launch
5. WHEN isHydrated becomes true, THE Feed_Screen SHALL render cached posts from Entity_Store instead of showing a skeleton loader

### Requirement 4: Stale-While-Revalidate Feed Display

**User Story:** As a user, I want to see cached posts instantly and have them update with fresh data in the background, so that the app feels fast without showing stale content for long.

#### Acceptance Criteria

1. WHEN the Feed_Screen mounts and Entity_Store contains cached posts, THE Feed_Screen SHALL display cached posts immediately
2. WHEN the Feed_Screen mounts, THE Sync_Engine SHALL initiate a background fetch of fresh posts from Supabase
3. WHEN the Sync_Engine receives fresh posts from Supabase, THE Entity_Store SHALL merge the fresh posts into the in-memory store and Cache_Layer
4. WHEN Entity_Store updates with fresh posts, THE Feed_Screen SHALL re-render to display the updated data
5. IF the background fetch fails due to network unavailability, THEN THE Feed_Screen SHALL continue displaying cached posts without error

### Requirement 5: Profile Caching and Revalidation

**User Story:** As a user, I want to see cached profile information immediately when viewing a profile, so that navigation feels instant.

#### Acceptance Criteria

1. WHEN the Profile_Screen mounts and Entity_Store contains a cached profile, THE Profile_Screen SHALL display the cached profile data immediately
2. WHEN the Profile_Screen mounts, THE Sync_Engine SHALL fetch the latest profile data from Supabase in the background
3. WHEN fresh profile data arrives from Supabase, THE Entity_Store SHALL update the cached profile in memory and in Cache_Layer
4. WHEN Entity_Store updates with a fresh profile, THE Profile_Screen SHALL re-render to display the updated data
5. IF the profile fetch fails due to network unavailability, THEN THE Profile_Screen SHALL continue displaying the cached profile without error

### Requirement 6: Likes and Follows Caching

**User Story:** As a user, I want my likes and follows to be cached locally, so that I see correct like states and follow statuses even when offline.

#### Acceptance Criteria

1. WHEN the user authenticates, THE Sync_Engine SHALL fetch the user's likes and follows from Supabase and store them in Cache_Layer
2. WHEN the App launches with a cached session, THE Entity_Store SHALL load the user's likes from Cache_Layer during Hydration
3. WHEN the user toggles a like while offline, THE Mutation_Queue SHALL enqueue the like mutation and THE Entity_Store SHALL apply the optimistic update immediately
4. WHEN the user follows or unfollows a profile while offline, THE Mutation_Queue SHALL enqueue the follow mutation and THE Entity_Store SHALL apply the optimistic update immediately
5. WHEN network connectivity is restored, THE Mutation_Queue SHALL replay pending like and follow mutations to Supabase

### Requirement 7: Comments Caching

**User Story:** As a user, I want to see previously loaded comments when I revisit a post, so that I can read discussions even when offline.

#### Acceptance Criteria

1. WHEN comments are fetched for a post, THE Cache_Layer SHALL store the comments locally
2. WHEN the comments screen opens for a post with cached comments, THE App SHALL display cached comments immediately
3. WHEN the comments screen opens, THE Sync_Engine SHALL fetch fresh comments from Supabase in the background
4. WHEN fresh comments arrive, THE App SHALL update the displayed comments with the latest data
5. WHEN the user creates a comment while offline, THE Mutation_Queue SHALL enqueue the comment mutation and THE App SHALL display the comment optimistically

### Requirement 8: Background Sync Loop

**User Story:** As a user, I want the app to periodically sync data in the background, so that my cached content stays reasonably fresh while I use the app.

#### Acceptance Criteria

1. WHEN the user is authenticated and the App is in the foreground, THE Sync_Engine SHALL start a periodic sync loop
2. THE Sync_Engine SHALL process the Mutation_Queue and fetch fresh feed data at a 30-second interval
3. WHEN the App moves to the background, THE Sync_Engine SHALL stop the periodic sync loop
4. WHEN the App returns to the foreground, THE Sync_Engine SHALL restart the periodic sync loop
5. IF a sync cycle fails due to network unavailability, THEN THE Sync_Engine SHALL log a warning and retry on the next interval without crashing

### Requirement 9: Offline Write Operations via Mutation Queue

**User Story:** As a user, I want to create posts, like content, and comment while offline, so that my actions are preserved and synced when I reconnect.

#### Acceptance Criteria

1. WHEN the user creates a post while offline, THE Mutation_Queue SHALL enqueue the post creation and THE Entity_Store SHALL display the post optimistically with a temporary ID
2. WHEN the user deletes a post while offline, THE Mutation_Queue SHALL enqueue the deletion and THE Entity_Store SHALL remove the post from the local view immediately
3. WHEN network connectivity is restored, THE Mutation_Queue SHALL process pending mutations in FIFO order
4. WHEN a mutation is successfully sent to Supabase, THE Mutation_Queue SHALL mark the mutation as completed and replace temporary IDs with server-assigned IDs
5. IF a mutation fails permanently on the server, THEN THE Mutation_Queue SHALL mark the mutation as failed and retain the record for debugging

### Requirement 10: Online-Only Fallback Mode

**User Story:** As a user, I want the app to work normally in online-only mode when the cache is unavailable, so that SQLite issues do not prevent me from using the app.

#### Acceptance Criteria

1. WHILE the Noop_Database is active, THE Feed_Screen SHALL fetch posts directly from Supabase on each mount
2. WHILE the Noop_Database is active, THE Mutation_Queue SHALL send mutations directly to Supabase without local queuing
3. WHILE the Noop_Database is active, THE App SHALL not attempt to read from or write to Cache_Layer
4. THE App SHALL transition seamlessly between cached mode and online-only mode based on Cache_Layer availability at startup
