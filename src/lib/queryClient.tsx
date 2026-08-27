/**
 * TanStack Query — the server-state layer.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * Adopted from Bluesky (bluesky-social/social-app, MIT), which is React Native +
 * Expo + TypeScript like us and is a production social network. They use
 * `@tanstack/react-query` with `@tanstack/query-async-storage-persister` and
 * `@tanstack/react-query-persist-client` for exactly this job. No Bluesky code is
 * copied here — the architecture is adopted, the implementation is ours and sits
 * on our own storage.
 *
 * What it replaces. Every screen in this app currently hand-rolls its own server
 * cache, and no two do it the same way:
 *
 *   - MMKV snapshots per screen (`MY_POSTS_CACHE_KEY`, `LIKED_POSTS_CACHE_PREFIX`,
 *     `USER_REPLIES_CACHE_PREFIX`, the chat tail cache, …), each with its own
 *     hydrate function
 *   - `syncThrottle` with a different window per resource (5 min, 10 min, 15 min)
 *   - write-side equality guards inside `entityStore` (`rowEqualIgnoring`,
 *     `POST_VOLATILE_FIELDS`) to stop identical payloads re-rendering everything
 *   - module-level ledgers to remember what a REMOUNT should not redo
 *     (`paintedProfileIds`, `requestedRepostOriginalIds`)
 *
 * Each of those was a correct local fix for a real reported bug. Together they are
 * the reason the app was described as held together with tape: a revisit behaves
 * differently on every screen, because every screen remembers different things by
 * a different mechanism. That is the actual root of "the data reloads" — not the
 * list, not the card, not the images.
 *
 * Query gives one cache keyed by query key, one staleness model, one persistence
 * layer, and a cached-first render on revisit as the DEFAULT rather than as
 * something each screen re-invents.
 *
 * ── MIGRATION IS INCREMENTAL, AND THAT IS DELIBERATE ────────────────────────
 *
 * This file only installs the provider. Nothing is migrated yet, and no existing
 * cache path is removed. A screen moves over when its queries are rewritten, and
 * the old path for that screen is deleted in the same change so the two can never
 * disagree. Order, worst measured first: `profile/[id]`, `chat/[id]`,
 * `(tabs)/profile`, `comments/[id]`.
 *
 * Adding the provider alone is inert: no component calls `useQuery` yet, so
 * behaviour is unchanged. That is the point — it makes the foundation shippable
 * and verifiable on its own.
 */
import React, { useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import {
  QueryClient,
  focusManager,
  type QueryClientConfig,
} from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { kvDeleteRaw, kvGetStringRawSync, kvSetStringRaw } from '../services/kvStore';

/**
 * How long a cached query stays usable across app launches.
 *
 * A week, matching the intent of the per-screen MMKV snapshots this replaces —
 * they had no expiry at all, which is worse: a stale post list from a month ago
 * would render before the network answered. Query still refetches on mount when
 * data is stale, so a long `maxAge` only affects what is shown on the FIRST frame
 * of a cold launch, which is exactly where we want something rather than nothing.
 */
const PERSIST_MAX_AGE = 1000 * 60 * 60 * 24 * 7;

/**
 * `gcTime` MUST be >= the persister's `maxAge`.
 *
 * Otherwise the in-memory cache garbage-collects an entry that the persisted
 * snapshot still contains, the persister writes the collected (empty) state back,
 * and the persisted copy is silently destroyed. Kept equal, deliberately.
 */
const GC_TIME = PERSIST_MAX_AGE;

const config: QueryClientConfig = {
  defaultOptions: {
    queries: {
      gcTime: GC_TIME,
      /**
       * Thirty seconds before a query is considered stale.
       *
       * The screens being replaced used 5-, 10- and 15-minute `syncThrottle`
       * windows. Those windows existed to stop a revisit hitting the network at
       * all, because a refetch meant a visible reload. Query decouples the two:
       * stale data is still RENDERED immediately from cache while the refetch
       * happens in the background, so the throttle no longer has to be long to
       * keep the screen calm. Individual queries override this where the data
       * genuinely changes slowly (a profile row) or fast (a chat transcript).
       */
      staleTime: 1000 * 30,
      /**
       * No refetch on window focus. React Native has no window; on mobile this
       * fires on every app foreground, which on a social app means a refetch
       * storm every time the user switches apps. `focusManager` below is wired
       * to AppState instead so Query still knows when we are backgrounded, which
       * is what pauses timers.
       */
      refetchOnWindowFocus: false,
      /**
       * Two retries, not the default three, and never on a 4xx.
       *
       * Our Worker returns 401/403 for an expired session and 404 for a deleted
       * post. Retrying those is pure latency: the answer will not change, and the
       * user waits through the backoff before seeing the error state.
       */
      retry: (failureCount, error) => {
        const status =
          (error as { status?: number } | null)?.status ??
          (error as { response?: { status?: number } } | null)?.response?.status;
        if (typeof status === 'number' && status >= 400 && status < 500) return false;
        return failureCount < 2;
      },
      /**
       * Keep showing the previous data while a refetch for a NEW key resolves.
       * This is the single most visible anti-reload setting: switching profile
       * tabs or opening a different profile keeps the old content on screen
       * instead of flashing an empty state, which is the "no posts" flash we had
       * to fix by hand on both profile screens.
       */
      placeholderData: <T,>(prev: T) => prev,
    },
    mutations: {
      retry: 0,
    },
  },
};

/**
 * Persister over our existing MMKV layer.
 *
 * NOT a second storage. `kvStore` already wraps react-native-mmkv v3 with a
 * transparent AsyncStorage fallback for when the native module fails to load, and
 * every cache in the app goes through it. Adding AsyncStorage here directly would
 * mean two storage backends with different failure modes and no shared clear
 * path (`kvClearAll` would miss it on sign-out).
 *
 * The raw (non account-namespaced) accessors are correct here: the query keys
 * themselves carry the account id where it matters, and namespacing the whole
 * blob would discard the entire cache on every account switch.
 */
const persister = createAsyncStoragePersister({
  storage: {
    getItem: async (key: string) => kvGetStringRawSync(key),
    setItem: async (key: string, value: string) => {
      kvSetStringRaw(key, value);
    },
    removeItem: async (key: string) => {
      kvDeleteRaw(key);
    },
  },
  key: 'san:react-query',
  /**
   * Coalesce writes. The default is 1000 ms; the cache blob is large (it holds
   * every post and message body we have fetched) and `JSON.stringify` of it on
   * the JS thread is exactly the class of long task this codebase has spent a
   * long time removing — the profile snapshot write was measured at 100-170 ms on
   * a weak device. Three seconds is still far more often than a crash.
   */
  throttleTime: 3000,
});

/** Created once per app process. */
export const queryClient = new QueryClient(config);

export function QueryProvider({ children }: { children: React.ReactNode }) {
  // ── AppState -> focusManager ───────────────────────────────────────────────
  //
  // `refetchOnWindowFocus` is off, but Query still needs to know when the app is
  // backgrounded so it can pause its own timers instead of running them while
  // nothing is on screen. This is the documented React Native wiring.
  useEffect(() => {
    const onChange = (status: AppStateStatus) => {
      focusManager.setFocused(status === 'active');
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, []);

  // Hold the options object stable. `PersistQueryClientProvider` restores from
  // storage when this identity changes, so an inline object would re-hydrate the
  // whole cache on every render of the root layout.
  const [persistOptions] = useState(() => ({
    persister,
    maxAge: PERSIST_MAX_AGE,
  }));

  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      {children}
    </PersistQueryClientProvider>
  );
}
