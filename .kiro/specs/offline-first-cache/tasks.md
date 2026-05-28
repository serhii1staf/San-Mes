# Implementation Plan: Offline-First Cache

## Overview

Wire the existing offline infrastructure (entityStore, syncEngine, mutationQueue, database) into the app lifecycle and UI screens. The code modules are already written — this plan focuses on dependency configuration, integration fixes, and connecting screens to the cache-first data flow.

## Tasks

- [x] 1. Add expo-sqlite dependency and plugin configuration
  - [x] 1.1 Add expo-sqlite to package.json and app.json plugins
    - Add `"expo-sqlite": "~15.1.3"` to `dependencies` in `package.json`
    - Add `"expo-sqlite"` to the `plugins` array in `app.json` (after `"./plugins/withFmtPatch"`)
    - _Requirements: 1.1, 1.2, 1.3_

- [x] 2. Fix database.ts hydration to always set isHydrated=true
  - [x] 2.1 Ensure initDatabase sets isHydrated on the entityStore when database fails
    - In `database.ts`, the `initDatabase()` function already sets `dbFailed = true` on failure
    - Verify that `entityStore.hydrate()` catches errors and sets `isHydrated = true` (already implemented in entityStore.ts)
    - Add a direct `useEntityStore.setState({ isHydrated: true })` call in `initDatabase()` when `dbFailed` becomes true, so hydration is guaranteed even if `hydrate()` is never called
    - _Requirements: 2.1, 2.2, 2.4, 2.5_

- [x] 3. Wire entityStore into _layout.tsx (module-level init + hydration guard)
  - [x] 3.1 Add module-level database init and hydration to _layout.tsx
    - Add `import { initDatabase } from '../src/lib/database'` at top of `app/_layout.tsx`
    - Add `import { useEntityStore } from '../src/lib/entityStore'` at top of `app/_layout.tsx`
    - Call `initDatabase()` at module scope (outside any component)
    - Call `useEntityStore.getState().hydrate()` at module scope immediately after `initDatabase()`
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 3.2 Add entityStore hydration guard to RootLayout component
    - Subscribe to `isHydrated` from entityStore: `const isHydrated = useEntityStore((s) => s.isHydrated)`
    - Add a 2-second safety timeout that forces `isHydrated = true` if it hasn't been set
    - Gate the `AuthNavigationGuard` rendering on `isHydrated` (show `CustomSplash` while waiting)
    - Combine with existing `hasHydrated` (auth store) and `fontsLoaded` checks
    - _Requirements: 2.2, 2.5, 3.4, 3.5_

- [x] 4. Checkpoint - Verify base integration
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Integrate feed screen with entityStore (stale-while-revalidate)
  - [x] 5.1 Replace local posts state with entityStore selectors in feed screen
    - In `app/(tabs)/index.tsx`, import `useEntityStore` and `syncFeed`
    - Replace `const [posts, setPosts] = useState<Post[]>([])` with entityStore selector: `const feedPosts = useEntityStore((s) => s.getFeedPosts())`
    - Read `isHydrated` from entityStore to determine skeleton display
    - Remove the `loadFeed` function that fetches directly from Supabase
    - Add a `useMemo` that maps `LocalPost[]` to `Post[]` using cached profiles from entityStore
    - Show skeleton only when `!isHydrated && feedPosts.length === 0`
    - _Requirements: 4.1, 4.4, 4.5_

  - [x] 5.2 Add background sync trigger on feed mount
    - Call `syncFeed(user.id)` in a `useEffect` when `isHydrated` is true and `user.id` is available
    - Keep the pull-to-refresh handler but rewire it to call `syncFeed(user.id)` instead of `loadFeed()`
    - Ensure the feed re-renders automatically via Zustand subscription when syncFeed updates the store
    - _Requirements: 4.2, 4.3_

  - [x] 5.3 Wire like state from entityStore into feed posts
    - Load user likes on mount: call `useEntityStore.getState().loadLikes(user.id)` in a useEffect
    - In the post mapping `useMemo`, read `isLiked` from entityStore: `store.isLiked(user.id, post.id)`
    - Replace `handleToggleLike` to use `queueMutation('toggle_like', { userId: user.id, postId })` from mutationQueue
    - _Requirements: 6.2, 6.3_

- [x] 6. Integrate profile screens with entityStore
  - [x] 6.1 Wire own profile screen (tabs/profile.tsx) to entityStore
    - Import `useEntityStore` and `syncProfile`, `syncUserPosts` from syncEngine
    - Read cached profile: `const cachedProfile = useEntityStore((s) => s.getProfile(user?.id ?? ''))`
    - Read cached posts: `const cachedPosts = useEntityStore((s) => s.getMyPosts(user?.id ?? ''))`
    - Use cached data for immediate display, trigger `syncProfile(user.id)` and `syncUserPosts(user.id)` in background
    - Map `LocalPost[]` to `Post[]` for rendering using cached profile info
    - Remove direct Supabase fetch in `loadMyPosts`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 6.2 Wire other-user profile screen (profile/[id].tsx) to entityStore
    - Import `useEntityStore` and `syncProfile`, `syncUserPosts` from syncEngine
    - Read cached profile: `const cachedProfile = useEntityStore((s) => s.getProfile(id ?? ''))`
    - Show cached profile immediately if available (skip loading spinner)
    - Trigger `syncProfile(id)` and `syncUserPosts(id)` in background useEffect
    - Read follow state from entityStore: `useEntityStore((s) => s.isFollowing(currentUser?.id ?? '', id ?? ''))`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [x] 7. Checkpoint - Verify screen integrations
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Add AppState-based sync lifecycle
  - [x] 8.1 Implement useSyncLifecycle hook in _layout.tsx
    - Create a `useSyncLifecycle` hook that accepts `userId` parameter
    - On mount (when userId is available): call `fullSync(userId)` then `startSyncLoop()`
    - Subscribe to `AppState.addEventListener('change', ...)`:
      - On `'active'`: call `startSyncLoop()`
      - On `'background'`/`'inactive'`: call `stopSyncLoop()`
    - On cleanup: call `stopSyncLoop()` and remove AppState subscription
    - Call this hook inside `AuthNavigationGuard` or `RootLayout` with the authenticated user's ID
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

- [x] 9. Wire mutation queue into like/follow/post actions
  - [x] 9.1 Replace direct API calls with queueMutation for likes in feed
    - In feed screen's `handleToggleLike`, replace `apiToggleLike(user.id, postId)` with `queueMutation('toggle_like', { userId: user.id, postId })`
    - Remove the local optimistic `setPosts` update (mutationQueue handles optimistic updates via entityStore)
    - _Requirements: 6.3, 9.1_

  - [x] 9.2 Replace direct API calls with queueMutation for follow/unfollow
    - In `profile/[id].tsx`, replace `followUser`/`unfollowUser` direct calls with `queueMutation('follow', ...)` and `queueMutation('unfollow', ...)`
    - Remove local optimistic state updates (mutationQueue handles them)
    - _Requirements: 6.4, 9.1_

  - [x] 9.3 Wire post creation through mutation queue
    - In `app/(tabs)/create.tsx`, replace direct `createPost` call with `queueMutation('create_post', { authorId, content, imageUrl, tempId })`
    - Ensure the optimistic post appears in feed immediately via entityStore
    - _Requirements: 9.1, 9.4_

- [x] 10. Final checkpoint - Full integration verification
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- The existing modules (entityStore.ts, syncEngine.ts, mutationQueue.ts, database.ts) are already functional — tasks focus on integration and wiring
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- The stale-while-revalidate pattern means screens read from entityStore first (instant), then sync in background
- When SQLite is unavailable, the noopDb ensures all operations are safe no-ops and the app falls back to online-only mode

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["3.1"] },
    { "id": 3, "tasks": ["3.2"] },
    { "id": 4, "tasks": ["5.1", "6.1", "6.2"] },
    { "id": 5, "tasks": ["5.2", "5.3", "8.1"] },
    { "id": 6, "tasks": ["9.1", "9.2", "9.3"] }
  ]
}
```
