import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { View, Pressable, ViewStyle, FlatList, ActivityIndicator, Text as RNText, InteractionManager } from 'react-native';
import Reanimated, { useSharedValue, useAnimatedStyle, useAnimatedScrollHandler } from 'react-native-reanimated';
import { CollapsingSearchField, SEARCH_ZONE_HEIGHT } from '../../src/components/ui/CollapsingSearchField';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../../src/theme';
import { Text, Avatar } from '../../src/components/ui';
import { VerifiedBadge } from '../../src/components/ui/VerifiedBadge';
import { UserBadge } from '../../src/components/ui/UserBadge';
import { getProfiles } from '../../src/lib/supabase';
import { useMiniAppsStore } from '../../src/store/miniAppsStore';
import { accountKey } from '../../src/services/cacheService';
import { kvGetStringRawSync } from '../../src/services/kvStore';
import { shouldSync } from '../../src/services/syncThrottle';
import { useT } from '../../src/i18n/store';
import { perfMonitor } from '../../src/services/perfMonitor';
import { useSettingsStore } from '../../src/store/settingsStore';
import { emojiTextStyle } from '../../src/components/ui/emojiText';


const SEARCH_HISTORY_KEY = '@san:search_history';

/**
 * Recently-opened MINI APPS, stored separately from the profile history.
 *
 * A separate key rather than one merged list, deliberately: `@san:search_history` is already
 * on disk for every existing user as a `ProfileResult[]`, and widening that array's element
 * type would mean a migration (or a silent crash the first time an old entry is read as an
 * app). Two keys, merged by timestamp at read time, needs no migration and cannot corrupt
 * what is already stored.
 */
const RECENT_APPS_KEY = '@san:search_recent_apps';

interface ProfileResult {
  id: string;
  username: string;
  display_name: string;
  emoji: string;
  bio: string;
  badge?: string;
  is_verified?: boolean;
  /** When this entry was last opened. Absent on entries written before recents existed. */
  ts?: number;
}

interface RecentApp {
  id: string;
  name: string;
  emoji: string;
  url: string;
  ts?: number;
}

/** One tile in the "Recent" strip — either a person or a mini app. */
type RecentEntry =
  | { kind: 'profile'; ts: number; id: string; profile: ProfileResult }
  | { kind: 'app'; ts: number; id: string; app: RecentApp };

/** A trimmed post, just enough for the preview cards under the top result. */
interface SearchPreviewPost {
  id: string;
  content: string;
  likes: number;
  comments: number;
}

/** How many of the top match's posts to show. Three fills the gap without pushing the second result off screen. */
const PREVIEW_POST_LIMIT = 3;

/** Tile width. Sized so four fit on a 390 pt screen with the row's padding, as in the design. */
const RECENT_TILE_WIDTH = 78;

/** How many tiles the strip keeps. Bounded so the row can never become a long list. */
const RECENT_LIMIT = 12;

type AppTheme = ReturnType<typeof useTheme>;

/**
 * One tile in the "Recent" strip: a round 64 pt avatar with its name underneath.
 *
 * Memoized and given only primitives plus a stable callback, so scrolling the strip or
 * typing in the field does not re-render tiles that have not changed.
 */
const RecentTile = React.memo(function RecentTile({
  emoji,
  label,
  verified,
  badge,
  onPress,
}: {
  emoji: string;
  label: string;
  verified?: boolean;
  badge?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{ width: RECENT_TILE_WIDTH, alignItems: 'center' }}
    >
      <Avatar emoji={emoji} name={label} size="lg" tint />
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 2,
          marginTop: 8,
          maxWidth: RECENT_TILE_WIDTH - 6,
        }}
      >
        <Text variant="caption" numberOfLines={1} style={{ flexShrink: 1 }}>
          {label}
        </Text>
        {verified ? <VerifiedBadge size={10} /> : null}
        {badge ? <UserBadge badge={badge} size="sm" /> : null}
      </View>
    </Pressable>
  );
});

// Pure presentational result row. Memoized so unchanged rows don't re-render
// when the parent re-renders on each keystroke. `theme` is stable across
// renders and `onSelect` is a stable useCallback, so memo only re-renders a
// row when its `item` actually changes. Markup/styles are identical to the
// previous inline renderItem — no visual or behavioral change.
const SearchResultRow = React.memo(function SearchResultRow({
  item,
  theme,
  onSelect,
}: {
  item: ProfileResult;
  theme: AppTheme;
  onSelect: (item: ProfileResult) => void;
}) {
  return (
    <Pressable
      onPress={() => onSelect(item)}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        borderBottomWidth: 0.5,
        borderBottomColor: theme.colors.border.light,
      }}
    >
      <Avatar emoji={item.emoji} size="md" />
      <View style={{ marginLeft: 12, flex: 1, overflow: 'hidden' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
          <Text variant="body" weight="semibold" numberOfLines={1} style={{ flexShrink: 1 }}>{item.display_name}</Text>
          {item.is_verified && <VerifiedBadge size={12} />}
          {item.badge && <UserBadge badge={item.badge} size="sm" />}
        </View>
        <Text variant="caption" color={theme.colors.text.secondary} numberOfLines={1}>@{item.username}</Text>
      </View>
      <Feather name="chevron-right" size={18} color={theme.colors.text.tertiary} />
    </Pressable>
  );
});

export default function SearchScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  // Mount-time marker — search tab is small but still has a synchronous
  // history hydrate. Skip at the call site when the monitor is off so we
  // don't pay the Date.now() + function hop on tab focus.
  const mountStart = useRef(Date.now()).current;
  // Fire ONCE on first mount. See (tabs)/index.tsx for the same fix
  // rationale — store-read at effect-time avoids stale-mountStart re-fires.
  useEffect(() => {
    if (!useSettingsStore.getState().perfMonitorEnabled) return;
    perfMonitor.markScreenMount('(tabs)/search', Date.now() - mountStart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [isFocused, setIsFocused] = useState(false);
  const [query, setQuery] = useState('');
  // Debounced mirror of `query`. The text input stays fully controlled by
  // `query` (responsive on every keystroke); only the heavy profile filter
  // reads `debouncedQuery`, so the directory scan runs at most once per
  // ~160 ms idle window instead of on every keystroke. See the debounce
  // effect below.
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [profiles, setProfiles] = useState<ProfileResult[]>([]);
  // Cache-first hydrate: `@san:all_profiles` is a GLOBAL (un-namespaced) key
  // stored raw in MMKV. We start EMPTY and defer the full JSON.parse off the
  // mount frame (see the InteractionManager hydrate effect below) so a large
  // directory never lands a synchronous parse on the navigation-transition
  // frame. The network refresh in loadProfiles() also fills this in.
  const [allProfiles, setAllProfiles] = useState<ProfileResult[]>([]);
  // Only show the loading spinner when there's genuinely nothing to display.
  // We do a CHEAP synchronous existence check on the cache (just reading the
  // raw string — no JSON.parse) so that, when a cache exists, the spinner is
  // never shown even though `allProfiles` is still empty for the brief window
  // before the deferred hydrate runs. This preserves the no-flash behavior.
  const [isLoading, setIsLoading] = useState(() => {
    try {
      const raw = kvGetStringRawSync('@san:all_profiles');
      return !(raw && raw.length > 2);
    } catch {
      return true;
    }
  });
  const [history, setHistory] = useState<ProfileResult[]>([]);
  const [recentApps, setRecentApps] = useState<RecentApp[]>([]);

  useEffect(() => {
    loadProfiles();
    loadHistory();
    useMiniAppsStore.getState().loadApps();
  }, []);

  // Deferred full hydrate of the cached profile directory. Mirrors the feed
  // cache hydrate in (tabs)/index.tsx: the heavy JSON.parse of the entire
  // `@san:all_profiles` blob runs AFTER the navigation transition settles via
  // InteractionManager, so it never blocks first paint. Uses a functional
  // setState so it won't clobber fresher data already set by the network
  // refresh in loadProfiles().
  useEffect(() => {
    const handle = InteractionManager.runAfterInteractions(() => {
      try {
        const raw = kvGetStringRawSync('@san:all_profiles');
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setAllProfiles((prev) => (prev.length > 0 ? prev : (parsed as ProfileResult[])));
        }
      } catch {}
    });
    return () => handle.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounce `query` → `debouncedQuery`. Keeps the input responsive while
  // collapsing bursts of keystrokes into a single filter pass. The timer is
  // cleared on every change (and on unmount) so no stale timeout leaks.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query), 160);
    return () => clearTimeout(id);
  }, [query]);

  // Get mini-apps from store (reactive)
  const miniApps = useMiniAppsStore((s) => s.apps);

  // Prebuilt lowercase search index. Lowercasing each profile's username and
  // display name ONCE here (recomputed only when `allProfiles` changes) means
  // the per-search filter does cheap includes() against precomputed strings
  // instead of calling toLowerCase() twice per profile on every pass.
  const searchIndex = useMemo(
    () =>
      allProfiles.map((p) => ({
        profile: p,
        username_lc: (p.username || '').toLowerCase(),
        display_name_lc: (p.display_name || '').toLowerCase(),
      })),
    [allProfiles]
  );

  useEffect(() => {
    if (debouncedQuery.trim()) {
      const searchTerm = debouncedQuery.startsWith('#') ? debouncedQuery.slice(1) : debouncedQuery;
      const lower = searchTerm.toLowerCase();
      const filtered = searchIndex
        .filter((e) => e.username_lc.includes(lower) || e.display_name_lc.includes(lower))
        .map((e) => e.profile);
      setProfiles(filtered);
    } else {
      setProfiles([]);
    }
  }, [debouncedQuery, searchIndex]);

  const loadProfiles = async () => {
    // Only gate the UI behind a spinner when we have nothing cached to show.
    // Cheap existence check (no JSON.parse) so a warm cache never flips the
    // spinner on and flashes the already-interactive screen.
    let hasCache = false;
    try {
      const raw = kvGetStringRawSync('@san:all_profiles');
      hasCache = !!(raw && raw.length > 2);
    } catch {}
    if (!hasCache) setIsLoading(true);
    // Throttle gate: only hit the profile-directory network fetch if we
    // haven't synced recently (~15 min). The cache-first display path above
    // (cheap existence check) and the deferred InteractionManager hydrate of
    // the cached directory still run, so the screen shows cached profiles
    // instantly even when we skip the network. shouldSync records the
    // timestamp when it returns true.
    if (!(await shouldSync('search_all_profiles', 15 * 60 * 1000))) {
      setIsLoading(false);
      return;
    }
    const { profiles: data } = await getProfiles();
    if (Array.isArray(data) && data.length > 0) setAllProfiles(data as any[]);
    setIsLoading(false);
  };

  const loadHistory = async () => {
    try {
      const cached = await AsyncStorage.getItem(accountKey(SEARCH_HISTORY_KEY));
      if (cached) setHistory(JSON.parse(cached));
    } catch {}
    try {
      const cachedApps = await AsyncStorage.getItem(accountKey(RECENT_APPS_KEY));
      if (cachedApps) setRecentApps(JSON.parse(cachedApps));
    } catch {}
  };

  const addToHistory = useCallback(async (profile: ProfileResult) => {
    const stamped = { ...profile, ts: Date.now() };
    const updated = [stamped, ...history.filter(h => h.id !== profile.id)].slice(0, RECENT_LIMIT);
    setHistory(updated);
    await AsyncStorage.setItem(accountKey(SEARCH_HISTORY_KEY), JSON.stringify(updated));
  }, [history]);

  /**
   * Record a mini app in the recents strip.
   *
   * Only the four fields the tile and the relaunch need are stored, not the whole `MiniApp`:
   * the strip must keep working for an app that has since been renamed, edited or removed
   * from the account's list, and a fat copy would go stale in ways the tile would show.
   */
  const addAppToRecents = useCallback(async (app: { id: string; name: string; emoji: string; url: string }) => {
    const entry: RecentApp = { id: app.id, name: app.name, emoji: app.emoji, url: app.url, ts: Date.now() };
    const updated = [entry, ...recentApps.filter(a => a.id !== app.id)].slice(0, RECENT_LIMIT);
    setRecentApps(updated);
    await AsyncStorage.setItem(accountKey(RECENT_APPS_KEY), JSON.stringify(updated));
  }, [recentApps]);

  const clearHistory = async () => {
    setHistory([]);
    setRecentApps([]);
    await AsyncStorage.multiRemove([accountKey(SEARCH_HISTORY_KEY), accountKey(RECENT_APPS_KEY)]);
  };

  const handleSelect = useCallback((item: ProfileResult) => {
    addToHistory(item);
    router.push({ pathname: '/profile/[id]', params: { id: item.id } });
  }, [addToHistory]);

  const openApp = useCallback((app: { id: string; name: string; emoji: string; url: string }) => {
    addAppToRecents(app);
    router.push({ pathname: '/mini-app', params: { url: encodeURIComponent(app.url), name: app.name, emoji: app.emoji } });
  }, [addAppToRecents]);

  /**
   * The strip's contents: people and mini apps in one list, newest first.
   *
   * Entries written before recents existed have no `ts`. They get a negative pseudo-stamp
   * that preserves their stored order and sorts them after everything with a real timestamp,
   * so an old history does not outrank something opened a moment ago.
   */
  const recents = useMemo<RecentEntry[]>(() => {
    const people: RecentEntry[] = history.map((p, i) => ({
      kind: 'profile', ts: p.ts ?? -(i + 1), id: `p:${p.id}`, profile: p,
    }));
    const apps: RecentEntry[] = recentApps.map((a, i) => ({
      kind: 'app', ts: a.ts ?? -(i + 1), id: `a:${a.id}`, app: a,
    }));
    return [...people, ...apps].sort((x, y) => y.ts - x.ts).slice(0, RECENT_LIMIT);
  }, [history, recentApps]);

  const recentKeyExtractor = useCallback((e: RecentEntry) => e.id, []);

  const renderRecent = useCallback(({ item }: { item: RecentEntry }) => (
    item.kind === 'profile' ? (
      <RecentTile
        emoji={item.profile.emoji}
        label={item.profile.display_name || item.profile.username}
        verified={item.profile.is_verified}
        badge={item.profile.badge}
        onPress={() => handleSelect(item.profile)}
      />
    ) : (
      <RecentTile
        emoji={item.app.emoji}
        label={item.app.name}
        onPress={() => openApp(item.app)}
      />
    )
  ), [handleSelect, openApp]);

  const containerStyle = useMemo<ViewStyle>(() => ({
    flex: 1,
    backgroundColor: theme.colors.background.primary,
    paddingTop: insets.top,
  }), [theme, insets.top]);

  // ── A taste of the top match's content ──────────────────────────────────────
  //
  // The first result gets a few of its author's most recent posts rendered directly
  // underneath, so a search for a person answers "is this the right person" without a
  // round trip into their profile.
  //
  // Fetched rather than derived: deriving it would mean subscribing to the entity store's
  // whole `posts` map and scanning it, which is exactly the subscription that makes
  // `app/profile/[id].tsx` re-render on every unrelated upsert. A tiny `limit=3` request
  // keyed on the author, memoised per author for the session, costs one round trip and
  // cannot re-render this screen on someone else's activity.
  const topResultId = profiles.length > 0 ? profiles[0].id : null;
  const [previewPosts, setPreviewPosts] = useState<SearchPreviewPost[]>([]);
  const previewCacheRef = useRef<Map<string, SearchPreviewPost[]>>(new Map());

  useEffect(() => {
    if (!topResultId) { setPreviewPosts([]); return; }
    const cached = previewCacheRef.current.get(topResultId);
    if (cached) { setPreviewPosts(cached); return; }
    setPreviewPosts([]);
    let cancelled = false;
    // Off the keystroke frame. `debouncedQuery` already collapses typing bursts, but the
    // author can still change on consecutive settled queries.
    const handle = InteractionManager.runAfterInteractions(async () => {
      try {
        const { apiGet } = await import('../../src/services/apiClient');
        const { data } = await apiGet<any[]>(
          `/v1/profiles/${encodeURIComponent(topResultId)}/posts?limit=${PREVIEW_POST_LIMIT}`,
        );
        if (cancelled || !Array.isArray(data)) return;
        const mapped: SearchPreviewPost[] = data.slice(0, PREVIEW_POST_LIMIT).map((p: any) => ({
          id: String(p.id),
          content: typeof p.content === 'string' ? p.content : '',
          likes: Number(p.likes_count) || 0,
          comments: Number(p.comments_count) || 0,
        }));
        previewCacheRef.current.set(topResultId, mapped);
        if (!cancelled) setPreviewPosts(mapped);
      } catch {}
    });
    return () => { cancelled = true; handle.cancel(); };
  }, [topResultId]);

  // Stable list props so FlatList doesn't see new identities each keystroke.
  const keyExtractor = useCallback((item: ProfileResult) => item.id, []);

  const renderItem = useCallback(
    ({ item, index }: { item: ProfileResult; index: number }) => (
      <>
        <SearchResultRow item={item} theme={theme} onSelect={handleSelect} />
        {index === 0 && previewPosts.length > 0 ? (
          <View style={{ paddingLeft: 56, paddingTop: 10, paddingBottom: 4, gap: 10 }}>
            {previewPosts.map((p) => (
              <Pressable
                key={p.id}
                // `/comments/[id]` IS the post detail route in this app — there is no
                // `/post/[id]`.
                onPress={() => router.push({ pathname: '/comments/[id]', params: { id: p.id } })}
                style={{
                  backgroundColor: theme.colors.background.elevated,
                  borderRadius: 12,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                }}
              >
                <Text variant="caption" numberOfLines={3}>{p.content || '—'}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Feather name="heart" size={11} color={theme.colors.text.tertiary} />
                    <Text variant="caption" color={theme.colors.text.tertiary}>{p.likes}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Feather name="message-circle" size={11} color={theme.colors.text.tertiary} />
                    <Text variant="caption" color={theme.colors.text.tertiary}>{p.comments}</Text>
                  </View>
                </View>
              </Pressable>
            ))}
          </View>
        ) : null}
      </>
    ),
    [theme, handleSelect, previewPosts]
  );

  const listContentStyle = useMemo(() => ({
    paddingHorizontal: theme.spacing.base,
    paddingTop: 16,
    paddingBottom: 100,
  }), [theme]);

  // The strip's own padding. `base - 6` because each tile is centred inside RECENT_TILE_WIDTH,
  // so the first avatar already carries ~6 pt of its own slack; using the full base inset
  // would leave the row visibly further from the edge than the heading above it.
  const recentStripStyle = useMemo(() => ({
    paddingHorizontal: theme.spacing.base - 6,
  }), [theme]);

  // Mini apps are their OWN category now, rendered as the list FOOTER rather than mixed in
  // above the people. Matching apps used to sit in the header, so a query that hit both an
  // app and a person put the app first and pushed the person the user was actually looking
  // for below the fold.
  const matchedApps = useMemo(() => {
    const term = debouncedQuery.startsWith('#') ? debouncedQuery.slice(1) : debouncedQuery;
    const lower = term.trim().toLowerCase();
    if (!lower) return [];
    return miniApps.filter(
      (a) => a.name.toLowerCase().includes(lower) || (a.description || '').toLowerCase().includes(lower),
    );
  }, [debouncedQuery, miniApps]);

  const listFooter = useMemo(() => {
    if (matchedApps.length === 0) return null;
    return (
      <View style={{ marginTop: 18 }}>
        <Text variant="caption" weight="semibold" color={theme.colors.text.secondary} style={{ marginBottom: 8 }}>{t('search.mini_apps')}</Text>
        {matchedApps.slice(0, 5).map(app => (
          <Pressable key={app.id} onPress={() => openApp(app)} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8 }}>
            <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: theme.colors.accent.primary + '12', alignItems: 'center', justifyContent: 'center', overflow: 'visible' }}>
              <RNText style={emojiTextStyle(18)} allowFontScaling={false}>{app.emoji}</RNText>
            </View>
            <Text variant="body" weight="medium" style={{ marginLeft: 10 }}>{app.name}</Text>
          </Pressable>
        ))}
      </View>
    );
  }, [matchedApps, theme, t, openApp]);

  const listEmpty = useMemo(() => (
    <View style={{ alignItems: 'center', paddingTop: 40 }}>
      <Text variant="body" color={theme.colors.text.tertiary}>{t('search.empty')}</Text>
    </View>
  ), [theme, t]);

  const showRecents = !query.trim() && recents.length > 0;

  const clearQuery = useCallback(() => setQuery(''), []);

  // ── Collapse plumbing, mirroring app/(tabs)/messages.tsx exactly ─────────────
  //
  // A shared value written by a UI-thread scroll worklet, NOT React state. See the long note
  // on `CollapsingSearchField` for why a threshold plus a height animation oscillates and a
  // continuous transform cannot.
  const searchCollapse = useSharedValue(0);
  const onSearchScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      'worklet';
      const y = e.contentOffset.y;
      searchCollapse.value = Math.min(Math.max(y / SEARCH_ZONE_HEIGHT, 0), 1);
    },
  });
  const searchLiftStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -SEARCH_ZONE_HEIGHT * searchCollapse.value }],
  }));

  return (
    <View style={containerStyle}>
      {/* ── The SAME collapsing field the chat list uses ─────────────────────────
          Literally the same component (src/components/ui/CollapsingSearchField.tsx), which is
          the only way "it should behave exactly like the one in the chat list" can be true and
          stay true. What was here before was a separate static pill with a focus-coloured
          border and no scroll behaviour at all.

          The squash is driven by a shared value off a UI-thread scroll worklet, so scrolling
          the results never touches React state — see the long note on the component. */}
      <CollapsingSearchField
        value={query}
        onChangeText={setQuery}
        placeholder={t('search.placeholder')}
        theme={theme}
        progress={searchCollapse}
        onClear={clearQuery}
      />

      {/* Everything below the field rides UP as the field squashes, by exactly the height the
          field gave back. `marginBottom: -SEARCH_ZONE_HEIGHT` on the lifted block means the
          lift never exposes empty space at the bottom — the same trick the chat list uses. */}
      <Reanimated.View style={[{ flex: 1, marginBottom: -SEARCH_ZONE_HEIGHT }, searchLiftStyle]}>

      {/* ── Recent ──────────────────────────────────────────────────────────────
          A HORIZONTAL strip of round avatars with the name underneath, holding people and
          mini apps together, newest first. It replaces a vertical list of full-width rows
          (avatar + name + @handle + a clock icon), which spent a whole screen on four
          entries and read as a second set of search results rather than as shortcuts.

          Horizontal FlatList rather than a ScrollView: `recents` is capped at RECENT_LIMIT,
          so the strip can never be long, but the FlatList still costs nothing and keeps the
          windowing props consistent with every other list in the app. */}
      {showRecents && (
        <View style={{ paddingTop: 18 }}>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              paddingHorizontal: theme.spacing.base,
              marginBottom: 14,
            }}
          >
            <Text variant="subheading" weight="bold">{t('search.recent')}</Text>
            <Pressable onPress={clearHistory} hitSlop={10} accessibilityRole="button">
              <Text variant="caption" color={theme.colors.text.tertiary}>{t('search.clear')}</Text>
            </Pressable>
          </View>
          <FlatList
            data={recents}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={recentKeyExtractor}
            renderItem={renderRecent}
            contentContainerStyle={recentStripStyle}
            initialNumToRender={6}
            maxToRenderPerBatch={4}
            windowSize={3}
            removeClippedSubviews={true}
          />
        </View>
      )}

      {/* Results */}
      {isLoading && !showRecents ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={theme.colors.accent.primary} />
        </View>
      ) : query.trim() ? (
        <Reanimated.FlatList
          data={profiles}
          keyExtractor={keyExtractor}
          contentContainerStyle={listContentStyle}
          // Drives the field's squash. A worklet on the UI thread, so scrolling the results
          // produces no JS work and no re-render at all.
          onScroll={onSearchScroll}
          scrollEventThrottle={16}
          // Virtualization props were absent here — a username search that
          // matches a large slice of the profile directory would mount every
          // matched row at once on each keystroke (search-as-you-type is the
          // hot path). These are purely additive and match the tuning used by
          // the feed / messages / comments lists. removeClippedSubviews detaches
          // off-screen rows; the window caps how many mount per batch so a big
          // result set streams in instead of landing as one long task.
          removeClippedSubviews={true}
          initialNumToRender={10}
          maxToRenderPerBatch={8}
          windowSize={7}
          renderItem={renderItem}
          ListEmptyComponent={listEmpty}
          // Mini apps as their own trailing category — see `listFooter`.
          ListFooterComponent={listFooter}
        />
      ) : null}
      </Reanimated.View>
    </View>
  );
}