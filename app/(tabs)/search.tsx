import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { View, Pressable, ViewStyle, TextInput, FlatList, ActivityIndicator, Text as RNText, InteractionManager } from 'react-native';
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

  // Stable list props so FlatList doesn't see new identities each keystroke.
  const keyExtractor = useCallback((item: ProfileResult) => item.id, []);

  const renderItem = useCallback(
    ({ item }: { item: ProfileResult }) => (
      <SearchResultRow item={item} theme={theme} onSelect={handleSelect} />
    ),
    [theme, handleSelect]
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

  const ListHeader = useCallback(() => {
    const searchTerm = query.startsWith('#') ? query.slice(1) : query;
    const lower = searchTerm.toLowerCase();
    const matchedApps = miniApps.filter(a => a.name.toLowerCase().includes(lower) || a.description.toLowerCase().includes(lower));
    if (matchedApps.length === 0) return null;
    return (
      <View style={{ marginBottom: 16 }}>
        <Text variant="caption" weight="semibold" color={theme.colors.text.secondary} style={{ marginBottom: 8 }}>{t('search.mini_apps')}</Text>
        {matchedApps.slice(0, 3).map(app => (
          <Pressable key={app.id} onPress={() => openApp(app)} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8 }}>
            <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: theme.colors.accent.primary + '12', alignItems: 'center', justifyContent: 'center', overflow: 'visible' }}>
              <RNText style={{ fontSize: 18 }} allowFontScaling={false}>{app.emoji}</RNText>
            </View>
            <Text variant="body" weight="medium" style={{ marginLeft: 10 }}>{app.name}</Text>
          </Pressable>
        ))}
      </View>
    );
  }, [query, miniApps, theme, t, openApp]);

  const listEmpty = useMemo(() => (
    <View style={{ alignItems: 'center', paddingTop: 40 }}>
      <Text variant="body" color={theme.colors.text.tertiary}>{t('search.empty')}</Text>
    </View>
  ), [theme, t]);

  const showRecents = !query.trim() && recents.length > 0;

  return (
    <View style={containerStyle}>
      {/* Search Input.
          The screen used to carry a bold "Поиск" heading directly above this field, which
          restated the field's own placeholder and pushed everything down by a line. The field
          is the first thing on the screen now, matching the design. */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: theme.spacing.base,
          paddingVertical: theme.spacing.sm,
          backgroundColor: theme.colors.background.elevated,
          borderRadius: 14,
          marginHorizontal: theme.spacing.base,
          marginTop: theme.spacing.sm,
          borderWidth: isFocused ? 1.5 : 1,
          borderColor: isFocused ? theme.colors.accent.primary : theme.colors.border.light,
        }}
      >
        <Feather
          name="search"
          size={18}
          color={isFocused ? theme.colors.accent.primary : theme.colors.text.tertiary}
        />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t('search.placeholder')}
          placeholderTextColor={theme.colors.text.tertiary}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          style={{
            flex: 1,
            marginLeft: theme.spacing.sm,
            fontSize: theme.typography.sizes.base,
            fontFamily: theme.fontFamily.regular,
            color: theme.colors.text.primary,
            paddingVertical: theme.spacing.xs,
          }}
        />
        {query.length > 0 && (
          <Pressable onPress={() => setQuery('')}>
            <Feather name="x" size={16} color={theme.colors.text.tertiary} />
          </Pressable>
        )}
      </View>

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
        <FlatList
          data={profiles}
          keyExtractor={keyExtractor}
          contentContainerStyle={listContentStyle}
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
          ListHeaderComponent={ListHeader}
          renderItem={renderItem}
          ListEmptyComponent={listEmpty}
        />
      ) : null}
    </View>
  );
}
