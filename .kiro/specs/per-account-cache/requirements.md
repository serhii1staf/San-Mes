# Requirements Document

## Introduction

San-Mes is a React Native (Expo SDK 54, RN 0.81) social/messaging app that supports multiple accounts on a single device. This feature delivers "Telegram-level" full caching with strict per-account cache isolation. Two outcomes drive the work:

1. **Instant, reload-free rendering.** When cached data already exists (another user's profile, the feed, my-posts, conversations, messages, mini-apps), it must render immediately. Revisiting a screen, leaving and re-entering a profile, or switching tabs must NOT trigger a visible reload or spinner. Fresh data is fetched in the background and reconciled silently, governed by the existing sync throttle so revisits within the throttle window do not refetch at all.

2. **Per-account cache isolation that is non-destructive.** Every piece of user-scoped cached data is stored under a per-account namespace. Switching from account A to account B never shows account A's data. Each account retains its own namespace, so switching back to a previously used account is instant. The system MUST NOT wipe cache on switch (the rejected "destructive" approach). Publicly shared data (public profiles) is stored once and shared across accounts to avoid redundant refetches.

The implementation must be smooth and optimized for weak devices, and must work reliably both offline and online.

This document grounds requirements in the current codebase: `src/services/cacheService.ts` (namespacing via `@acc:${activeAccountId}:${key}`), `src/services/syncThrottle.ts` (per-account throttle, 5-minute default), `src/services/entityStore.ts` (in-memory Zustand store hydrated from cache), `app/_layout.tsx` (startup account wiring), and `src/components/ui/AccountSwitcher.tsx` (non-destructive switch + `Updates.reloadAsync()`). It also targets the screens that currently bypass namespacing by reading/writing raw global AsyncStorage keys.

## Glossary

- **Cache_Service**: The module `src/services/cacheService.ts` that reads/writes AsyncStorage through per-account namespacing helpers (`cacheGet`, `cacheSet`, `cacheRemove`, `accountKey`, `setCacheAccount`, `getCacheAccount`).
- **Sync_Throttle**: The module `src/services/syncThrottle.ts` that records last-sync timestamps per account and answers `shouldSync(key, intervalMs)` to suppress redundant background refetches (default interval 5 minutes).
- **Entity_Store**: The Zustand in-memory store `src/services/entityStore.ts` that is hydrated from Cache_Service at startup and holds posts, profiles, conversations, and messages for rendering.
- **Sync_Service**: The module `src/services/syncService.ts` that fetches authoritative data from the backend (e.g. `syncProfile`, `syncUserPosts`).
- **Account_Switcher**: The component `src/components/ui/AccountSwitcher.tsx` used to switch between or add accounts; it reloads the app via `Updates.reloadAsync()`.
- **Active_Account_Id**: The identifier of the currently logged-in account that determines the active cache namespace. Equals the authenticated user's id, or the literal `anon` when no user is authenticated.
- **Account_Namespace**: The storage key prefix `@acc:${Active_Account_Id}:` applied to all account-scoped cache keys.
- **Anon_Namespace**: The Account_Namespace used when no account is authenticated, where Active_Account_Id is the literal string `anon`.
- **Account_Scoped_Data**: Cached data that belongs to a single account: feed posts, my-posts, conversations, messages, likes, follows, mini-apps list, search history, and sync timestamps.
- **Global_Shared_Data**: Cached data identical for every account and intentionally not duplicated per account: public profiles (`@san:profile:`) and the all-profiles batch (`@san:all_profiles`), identified by `GLOBAL_KEY_PREFIXES`.
- **Leaking_Screen**: A screen that currently reads/writes raw global AsyncStorage keys, bypassing Cache_Service namespacing: `app/(tabs)/index.tsx` (`@san:feed_posts`), `app/(tabs)/profile.tsx` (`@san:my_posts`), `app/(tabs)/create.tsx` (`@san:feed_posts`, `@san:my_posts`), and `app/settings/admin.tsx` (`@san:feed_posts`, `@san:my_posts`).
- **Cache_First_Render**: Rendering pattern where a screen displays cached data synchronously on mount/focus when present, without showing a loading indicator, while any refresh happens in the background.
- **Throttle_Window**: The time interval `intervalMs` passed to `shouldSync`; within this window a background refetch for that key is suppressed.
- **Visible_Reload**: Any user-perceivable loading state (spinner, blank screen, content flash/clear-then-refill) shown when cached data for that screen already exists.

## Requirements

### Requirement 1: Per-account namespacing of all account-scoped cache

**User Story:** As a developer, I want every account-scoped cache key stored under the active account's namespace, so that one account never reads or writes another account's data.

#### Acceptance Criteria

1. THE Cache_Service SHALL store every Account_Scoped_Data entry under the key format `@acc:${Active_Account_Id}:${key}`.
2. WHEN `cacheGet`, `cacheSet`, or `cacheRemove` is called with an Account_Scoped_Data key, THE Cache_Service SHALL apply the active Account_Namespace to the storage key.
3. WHERE a key matches a Global_Shared_Data prefix in `GLOBAL_KEY_PREFIXES`, THE Cache_Service SHALL store and read that entry without applying any Account_Namespace.
4. WHEN code outside Cache_Service needs to read or write an Account_Scoped_Data key directly through AsyncStorage, THE Cache_Service SHALL provide the `accountKey(baseKey)` helper that returns the namespaced key for the active account.
5. WHILE the active account is account A, THE Cache_Service SHALL return only entries written under account A's Account_Namespace for Account_Scoped_Data reads.

### Requirement 2: Eliminate raw-AsyncStorage cache leaks on application screens

**User Story:** As a tester, I want the feed, my-posts, and admin screens to use per-account cache keys, so that switching accounts never shows the previous account's posts.

#### Acceptance Criteria

1. WHEN `app/(tabs)/index.tsx` reads or writes the cached feed, THE Feed_Screen SHALL use the active account's namespaced key (via `accountKey` or Cache_Service) instead of the raw key `@san:feed_posts`.
2. WHEN `app/(tabs)/profile.tsx` reads or writes the cached my-posts list, THE Profile_Screen SHALL use the active account's namespaced key instead of the raw key `@san:my_posts`.
3. WHEN `app/(tabs)/create.tsx` updates the feed cache or the my-posts cache after creating or editing a post, THE Create_Screen SHALL use the active account's namespaced keys instead of the raw keys `@san:feed_posts` and `@san:my_posts`.
4. WHEN `app/settings/admin.tsx` removes a deleted post from the feed cache or the my-posts cache, THE Admin_Screen SHALL operate on the active account's namespaced keys instead of the raw keys `@san:feed_posts` and `@san:my_posts`.
5. THE per-account-cache feature SHALL ensure no application screen reads or writes an Account_Scoped_Data key through AsyncStorage without applying the active Account_Namespace.

### Requirement 3: Account-scoped namespacing for mini-apps and search history

**User Story:** As a user with multiple accounts, I want my mini-apps list and search history scoped to my account, so that another account on the device does not see my history or app list.

#### Acceptance Criteria

1. THE Cache_Service SHALL classify the mini-apps cache (`mini-apps-cache`) and the search history (`@san:search_history`) as Account_Scoped_Data.
2. WHEN the mini-apps list is persisted or read, THE Mini_Apps_Store SHALL use a storage key scoped to the active account.
3. WHEN search history is persisted, read, or cleared in `app/(tabs)/search.tsx`, THE Search_Screen SHALL use a storage key scoped to the active account.
4. WHILE the active account is account A, THE system SHALL NOT expose account B's mini-apps list or search history to account A.

### Requirement 4: Global shared data for public profiles

**User Story:** As a user, I want public profile data shared across accounts, so that the app does not redundantly refetch the same public profiles for each account.

#### Acceptance Criteria

1. THE Cache_Service SHALL treat keys prefixed with `@san:profile:` and the key `@san:all_profiles` as Global_Shared_Data.
2. WHEN any account reads a public profile that is already cached as Global_Shared_Data, THE Cache_Service SHALL return the shared cached profile without applying an Account_Namespace.
3. WHEN any account writes a public profile to cache, THE Cache_Service SHALL store it as Global_Shared_Data accessible to all accounts on the device.
4. THE Cache_Service SHALL exclude Global_Shared_Data from per-account isolation guarantees that apply to Account_Scoped_Data.

### Requirement 5: Instant cache-first rendering with no visible reload

**User Story:** As a user, I want screens with already-cached data to render instantly, so that revisiting a profile, returning to a screen, or switching tabs never shows a reload.

#### Acceptance Criteria

1. WHEN a screen mounts or gains focus AND cached data for that screen exists for the active account, THE screen SHALL render the cached data without showing a Visible_Reload.
2. WHEN a user leaves another user's profile and re-enters that profile within the same session AND that profile's data is cached, THE Profile_Detail_Screen SHALL render the cached profile, posts, and media containers without a Visible_Reload.
3. WHEN a user switches between tabs AND the destination tab's data is cached for the active account, THE destination tab SHALL render cached data without a Visible_Reload.
4. WHILE cached data is displayed AND a background refresh is in progress, THE screen SHALL continue showing the existing cached content until updated data is available.
5. WHEN no cached data exists for a screen, THE screen SHALL show a single loading indicator until data is available from cache or network.
6. WHEN background-refreshed data differs from displayed cached data, THE screen SHALL update the displayed content in place without clearing the screen to an empty or loading state.

### Requirement 6: Background revalidation governed by the sync throttle

**User Story:** As a developer, I want background refreshes governed by the sync throttle, so that revisits and tab-switches within the throttle window do not refetch data.

#### Acceptance Criteria

1. WHEN a screen with cached data mounts or gains focus, THE screen SHALL call `shouldSync(key, intervalMs)` before initiating any background network refresh for that data.
2. IF `shouldSync` returns false for a given key, THEN THE screen SHALL skip the background network refresh and continue displaying cached data.
3. IF `shouldSync` returns true for a given key, THEN THE screen SHALL perform a background network refresh without showing a Visible_Reload.
4. WHEN a user performs an explicit pull-to-refresh, THE screen SHALL reset the relevant throttle via `resetThrottle` and perform an immediate network refresh.
5. THE Sync_Throttle SHALL use a default Throttle_Window of 5 minutes when no interval is supplied.

### Requirement 7: Correct account context at startup

**User Story:** As a user, I want the app to load my own account's cached data when it starts, so that I never see another account's data after launch or reload.

#### Acceptance Criteria

1. WHEN the application starts in `app/_layout.tsx`, THE system SHALL call `setCacheAccount` and `setThrottleAccount` with the authenticated user's id before `Entity_Store` hydration begins.
2. IF no user is authenticated at startup, THEN THE system SHALL set the active account context to the Anon_Namespace.
3. WHEN `Entity_Store.hydrate()` runs at startup, THE Entity_Store SHALL load only the active account's Account_Scoped_Data from cache.
4. WHEN the application starts with cached data present for the active account, THE system SHALL render that cached data without a Visible_Reload before any network sync runs.

### Requirement 8: Correct account context on switch and add

**User Story:** As a user switching or adding accounts, I want the cache context updated to the target account, so that the target account immediately shows its own data.

#### Acceptance Criteria

1. WHEN a user switches to a saved account via Account_Switcher, THE system SHALL call `setCacheAccount` and `setThrottleAccount` with the target account's id before reloading the app.
2. WHEN a user adds and logs into a new account via Account_Switcher, THE system SHALL call `setCacheAccount` and `setThrottleAccount` with the new account's id before reloading the app.
3. WHEN the account context changes to a different account, THE Sync_Throttle SHALL reset its in-memory throttle state so the new account does not inherit the previous account's recently-synced timestamps.
4. WHEN account context is set for the target account, THE Account_Switcher SHALL reload the app via `Updates.reloadAsync()` so the target account's cache is loaded cleanly.

### Requirement 9: Non-destructive account switching with instant return

**User Story:** As a user, I want each account to keep its own cached data when I switch, so that returning to a previous account is instant and shows that account's data.

#### Acceptance Criteria

1. WHEN a user switches away from account A, THE system SHALL retain account A's Account_Scoped_Data in storage under account A's Account_Namespace.
2. THE Account_Switcher SHALL change the active account context without removing any account's Account_Scoped_Data from storage.
3. WHEN a user switches back to a previously used account whose data is still cached, THE system SHALL render that account's cached data without a Visible_Reload.
4. WHEN a user switches to account B, THE system SHALL display account B's own Account_Scoped_Data and SHALL NOT display account A's Account_Scoped_Data.

### Requirement 10: Offline reliability

**User Story:** As a user, I want the app to show my cached data when offline, so that I can keep using it without a network connection.

#### Acceptance Criteria

1. WHILE the device is offline AND cached data exists for the active account, THE screen SHALL render the cached data without a Visible_Reload.
2. IF a background network refresh fails while offline, THEN THE screen SHALL retain and continue displaying the existing cached data.
3. WHILE the device is offline AND no cached data exists for a screen, THE screen SHALL display an empty or offline state instead of an indefinite loading indicator.
4. WHEN connectivity is restored AND the relevant throttle permits, THE screen SHALL perform a background refresh and update displayed content in place.

### Requirement 11: Online reliability and data freshness

**User Story:** As a user, I want my data to stay current when online, so that I see up-to-date content without manual reloads.

#### Acceptance Criteria

1. WHILE the device is online AND the relevant Throttle_Window has elapsed for a screen's data, THE screen SHALL fetch updated data from Sync_Service in the background.
2. WHEN background-fetched data is received, THE screen SHALL write it to the active account's namespaced cache and update the display in place.
3. WHEN a user creates, edits, or deletes content while online, THE originating screen SHALL update the active account's namespaced cache so subsequent renders reflect the change without a Visible_Reload.

### Requirement 12: Performance and smoothness on weak devices

**User Story:** As a user on a low-end device, I want caching to be smooth and lightweight, so that the app does not lag or freeze.

#### Acceptance Criteria

1. WHEN a screen renders cached data on mount or focus, THE system SHALL read from cache without blocking the UI thread in a way that produces a perceptible freeze.
2. WHEN cached data is written after a network fetch or mutation, THE system SHALL perform the write without blocking the rendering of already-available content.
3. THE Cache_Service SHALL bound the size of the cached feed to at most `MAX_FEED_POSTS` (200) entries to limit storage and parse cost.
4. WHEN background refresh is suppressed by the Sync_Throttle, THE system SHALL avoid issuing the corresponding network request.

### Requirement 13: Graceful handling of AsyncStorage errors

**User Story:** As a user, I want the app to keep working when storage operations fail, so that a cache error never crashes the app or blocks content.

#### Acceptance Criteria

1. IF an AsyncStorage read fails in Cache_Service, THEN THE Cache_Service SHALL return the supplied fallback value and log a warning.
2. IF an AsyncStorage write fails in Cache_Service, THEN THE Cache_Service SHALL log a warning and allow the calling flow to continue.
3. IF cached JSON cannot be parsed, THEN THE Cache_Service SHALL return the supplied fallback value instead of throwing.
4. IF a Sync_Throttle storage read or write fails, THEN THE Sync_Throttle SHALL continue operating using its in-memory state without throwing.

### Requirement 14: Logged-out (anon) namespace fallback

**User Story:** As a user who is logged out, I want a dedicated cache namespace, so that anonymous data does not mix with any logged-in account's data.

#### Acceptance Criteria

1. WHEN no account is authenticated, THE Cache_Service SHALL use `anon` as the Active_Account_Id for the Account_Namespace.
2. WHEN no account is authenticated, THE Sync_Throttle SHALL use `anon` as the active account for its storage key.
3. WHEN `setCacheAccount` or `setThrottleAccount` is called with a null, undefined, or empty account id, THE receiving module SHALL fall back to the Anon_Namespace.
4. WHEN a user logs in from the logged-out state, THE system SHALL switch the active account context from `anon` to the authenticated user's id and SHALL retain the `anon` namespace data in storage.
