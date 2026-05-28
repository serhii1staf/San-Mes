# Implementation Plan: Async Storage Offline

## Overview

Replace the broken SQLite-based persistence layer with a pure AsyncStorage implementation. Create 5 new service files, integrate them into the app layout and all 5 screens, update store exports, then delete the old broken files. Order: infrastructure → integration → cleanup.

## Tasks

- [x] 1. Create infrastructure services
  - [x] 1.1 Create `src/services/cacheService.ts`
    - Implement `cacheGet<T>`, `cacheSet`, `cacheRemove` generic helpers with try-catch and JSON serialization
    - Define `KEYS` constant object with all namespaced keys (`@san:feed`, `@san:profile:{id}`, etc.)
    - Implement entity-specific helpers: `cacheFeed`, `getCachedFeed`, `cacheProfile`, `getCachedProfile`, `cacheConversations`, `getCachedConversations`, `cacheMessages`, `getCachedMessages`, `cacheLikes`, `getCachedLikes`, `cacheFollows`, `getCachedFollows`
    - Enforce `MAX_FEED_POSTS = 200` limit in `cacheFeed` (keep most recent by `created_at`)
    - All errors caught and logged with `console.warn`, never thrown
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 1.6, 7.1, 7.4_

  - [x] 1.2 Create `src/services/entityStore.ts`
    - Create Zustand store with `EntityState` interface (posts, profiles, likes, follows, conversations, feedIds, myPostIds, isHydrated)
    - Implement `hydrate()` action that reads from cacheService and sets `isHydrated = true` (even on failure)
    - Implement CRUD actions: `upsertPost`, `upsertPosts`, `upsertProfile`, `removePost`, `setLike`, `removeLike`, `isLiked`, `setFollow`, `removeFollow`, `isFollowing`, `setFeedIds`, `setMyPostIds`, `setConversations`, `replaceTempPost`
    - Add `isValidPost` and `isValidProfile` validation guards — reject invalid data silently
    - Export `useEntityStore` hook and `LocalPost`, `LocalProfile`, `LocalConversation`, `LocalMessage` types
    - _Requirements: 2.1, 2.3, 2.4, 2.5, 7.3_

  - [x] 1.3 Create `src/services/connectivityMonitor.ts`
    - Create Zustand store with `isOnline`, `lastChecked`, `start()`, `stop()`, `checkNow()` 
    - Implement `checkConnectivity()` using fetch HEAD to Supabase `/rest/v1/` with 5s AbortController timeout
    - Poll every 30 seconds via `setInterval`
    - On offline→online transition, call `processQueue()` from offlineQueue
    - Catch all errors (AbortError, TypeError) and set `isOnline = false` — never throw
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 7.5_

  - [x] 1.4 Create `src/services/offlineQueue.ts`
    - Define `MutationRecord` and `MutationType` interfaces
    - Implement `queueMutation(type, payload)` — applies optimistic update to entityStore + persists to AsyncStorage
    - Implement `processQueue()` — FIFO order, batch of 10 if queue > 50, otherwise all
    - Implement `getQueueLength()`, `getQueue()`, `removeMutation()`, `markFailed()`
    - Implement `generateTempId()` returning `temp_${Date.now()}_${random}`
    - Implement `uploadImageWithRetry(imageUri)` with 3 retries and exponential backoff
    - Handle error classification: 4xx → mark failed + continue; 5xx/network → retain pending + stop batch
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 5.4, 5.6, 7.6_

  - [x] 1.5 Create `src/services/syncService.ts`
    - Implement `syncFeed`, `syncProfile`, `syncProfiles`, `syncLikes`, `syncFollows`, `syncUserPosts`, `syncConversations`, `syncMessages`, `fullSync`
    - Each function: fetch from Supabase → map to local types → update entityStore → persist to cacheService
    - Import existing API functions from `src/lib/supabase.ts` (getPosts, getProfile, etc.)
    - Wrap every network call in try-catch, log warnings, never propagate errors to UI
    - _Requirements: 1.3, 6.5, 7.2, 8.6_

- [x] 2. Checkpoint - Verify infrastructure compiles
  - Ensure all 5 service files compile without TypeScript errors, ask the user if questions arise.

- [x] 3. Integrate into app layout and store exports
  - [x] 3.1 Update `src/store/index.ts` exports
    - Change `useEntityStore` export to point to `../services/entityStore` instead of `../lib/entityStore`
    - Change `LocalPost`, `LocalProfile` type exports to come from `../services/entityStore`
    - Add new exports: `useConnectivityStore` from `../services/connectivityMonitor`
    - _Requirements: 2.1, 2.2_

  - [x] 3.2 Update `app/_layout.tsx` to hydrate and start connectivity
    - Import `useEntityStore` from new services path (via store barrel)
    - Import `useConnectivityStore` from new services path (via store barrel)
    - After fonts load, call `useEntityStore.getState().hydrate()`
    - After hydration, call `useConnectivityStore.getState().start()`
    - Gate screen rendering on `isHydrated === true`
    - _Requirements: 1.2, 3.2, 6.1_

- [x] 4. Update screens to use new architecture
  - [x] 4.1 Update Feed screen (`app/(tabs)/index.tsx`)
    - Replace local `posts` state with reads from `useEntityStore` (posts, feedIds, isHydrated)
    - Replace `getCachedFeed`/`cacheFeed` imports with `syncFeed` from syncService
    - Read `isOnline` from `useConnectivityStore`
    - On mount: render immediately from store; trigger `syncFeed()` in background if online
    - On pull-to-refresh: call `syncFeed()` and update store
    - Remove direct `getPosts` call and manual mapping logic
    - Show pending indicator on posts with `status === 'pending'`
    - _Requirements: 6.1, 6.5, 6.6, 8.1_

  - [x] 4.2 Update Profile screen (`app/(tabs)/profile.tsx`)
    - Replace local `userPosts` state with reads from `useEntityStore` (posts, myPostIds)
    - Replace `getCachedMyPosts`/`cacheMyPosts` imports with `syncUserPosts` from syncService
    - On mount: render from store; trigger `syncUserPosts(userId)` in background
    - Show pending indicator on posts with `status === 'pending'`
    - _Requirements: 6.2, 8.2_

  - [x] 4.3 Update Other Profile screen (`app/profile/[id].tsx`)
    - Replace local profile/posts state with reads from `useEntityStore`
    - Replace `getCachedProfile`/`cacheProfile` imports with `syncProfile` from syncService
    - On mount: render from store (show loading only if no cached data); trigger `syncProfile(id)` in background
    - _Requirements: 6.3, 8.3_

  - [x] 4.4 Update Create screen (`app/(tabs)/create.tsx`)
    - Import `queueMutation` from offlineQueue and `useConnectivityStore`
    - When online: attempt direct API call; on failure, fall back to queue
    - When offline: call `queueMutation('create_post', { tempId, authorId, content, imageUris })`
    - Insert temp post into entityStore immediately with `status: 'pending'`
    - Remove Alert on network failure — queue silently instead
    - _Requirements: 5.1, 5.2, 5.3, 8.4_

  - [x] 4.5 Update Messages screen (`app/(tabs)/messages.tsx`)
    - Replace `useChatStore` conversations with reads from `useEntityStore` (conversations)
    - Import `syncConversations` from syncService
    - On mount: render from store; trigger `syncConversations(userId)` in background
    - _Requirements: 6.4, 8.5_

- [x] 5. Checkpoint - Verify integration compiles and screens render
  - Ensure all modified files compile without TypeScript errors, ask the user if questions arise.

- [x] 6. Cleanup old files
  - [x] 6.1 Delete broken files from `src/lib/`
    - Delete `src/lib/database.ts`
    - Delete `src/lib/entityStore.ts`
    - Delete `src/lib/syncEngine.ts`
    - Delete `src/lib/mutationQueue.ts`
    - Delete `src/lib/cache.ts`
    - _Requirements: 2.2_

  - [x] 6.2 Remove any remaining imports of deleted files
    - Search codebase for imports from `src/lib/database`, `src/lib/entityStore`, `src/lib/syncEngine`, `src/lib/mutationQueue`, `src/lib/cache`
    - Update or remove any stale references found
    - _Requirements: 2.2_

- [x] 7. Final checkpoint - Full compile check
  - Run `npx tsc --noEmit` to verify zero TypeScript errors across the project, ask the user if questions arise.

- [ ]* 8. Write property tests for cache service
  - [ ]* 8.1 Write property test for cache round-trip preservation
    - **Property 1: Cache round-trip preservation**
    - **Validates: Requirements 1.1, 1.3**

  - [ ]* 8.2 Write property test for cache feed size limit
    - **Property 4: Cache feed size limit**
    - **Validates: Requirements 1.6**

  - [ ]* 8.3 Write property test for cache error resilience
    - **Property 3: Cache error resilience**
    - **Validates: Requirements 1.5, 7.1, 7.4**

- [ ]* 9. Write property tests for entity store and queue
  - [ ]* 9.1 Write property test for entity store CRUD consistency
    - **Property 6: Entity store CRUD consistency**
    - **Validates: Requirements 2.3**

  - [ ]* 9.2 Write property test for hydration correctness
    - **Property 5: Hydration correctness**
    - **Validates: Requirements 1.2, 2.4, 2.5**

  - [ ]* 9.3 Write property test for mutation queue FIFO ordering
    - **Property 10: FIFO queue processing order**
    - **Validates: Requirements 4.3**

  - [ ]* 9.4 Write property test for batch processing under pressure
    - **Property 14: Batch processing under pressure**
    - **Validates: Requirements 7.6**

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- The language is TypeScript (already used throughout the project)
- No new native modules are introduced — only AsyncStorage (already installed)
- Property tests validate universal correctness properties from the design document
- The existing `src/lib/supabase.ts` is NOT deleted — it provides the API functions used by syncService

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["1.4"] },
    { "id": 3, "tasks": ["1.5"] },
    { "id": 4, "tasks": ["3.1", "3.2"] },
    { "id": 5, "tasks": ["4.1", "4.2", "4.3", "4.4", "4.5"] },
    { "id": 6, "tasks": ["6.1"] },
    { "id": 7, "tasks": ["6.2"] },
    { "id": 8, "tasks": ["8.1", "8.2", "8.3"] },
    { "id": 9, "tasks": ["9.1", "9.2", "9.3", "9.4"] }
  ]
}
```
