import React, { useState, useEffect, useCallback, useMemo, memo } from 'react';
import { View, Pressable, ViewStyle, FlatList, ScrollView, ActivityIndicator, Text as RNText, TextInput, InteractionManager, Keyboard, Platform, StyleSheet } from 'react-native';
import Reanimated, { useAnimatedStyle } from 'react-native-reanimated';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import { LinearGradient } from 'expo-linear-gradient';
import { useIsFocused } from '@react-navigation/native';
import { headerScrimHeights, SCRIM_LOCATIONS, topScrimColors } from '../../src/theme/scrim';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../../src/theme';
import { Text, Avatar } from '../../src/components/ui';
import { CachedImage } from '../../src/components/ui/CachedImage';
import { VerifiedBadge } from '../../src/components/ui/VerifiedBadge';
import { UserBadge } from '../../src/components/ui/UserBadge';
import { NativeGlassView, useLiquidGlassActive } from '../../src/components/ui/LiquidGlass';
import { getTabBarHeight } from '../../src/components/navigation/CustomTabBar';
import { syncProfiles } from '../../src/services/syncService';
import { useEntityStore } from '../../src/services/entityStore';
import { useProfilePosts, type ProfilePost } from '../../src/services/profilePosts';
import { useMiniAppsStore } from '../../src/store/miniAppsStore';
import { useIsBlocked } from '../../src/store/blockedUsersStore';
import { accountKey } from '../../src/services/cacheService';
import { kvGetStringRawSync } from '../../src/services/kvStore';
import { parseImageUrls } from '../../src/lib/supabase';
import { stripMarkers } from '../../src/utils/previewText';
import { useShortAgo } from '../../src/utils/shortAgo';
import { triggerHaptic } from '../../src/utils/haptics';
import { useT } from '../../src/i18n/store';
import { emojiTextStyle } from '../../src/components/ui/emojiText';
import { useScreenMountMark } from '../../src/hooks/useScreenMountMark';
import { useChatKeyboardMode } from '../../src/hooks/useChatKeyboardMode';

/**
 * Search: people and mini apps.
 *
 * Layout, top to bottom: the title over the same top fade as the chat list; recently opened people
 * and apps (or, once something is typed, the results); and the field itself at the BOTTOM, floating
 * just above the tab bar where the thumb already is. Tapping it raises the keyboard and the field
 * rides up on top of it (UI thread, `useReanimatedKeyboardAnimation`), so the results stay readable
 * from the top of the screen down to the field.
 *
 * The first result is shown as a card with that person's latest posts, so a search answers "is this
 * the right person" without opening the profile. Those posts come from the same cached page the
 * profile shows (`useProfilePosts`, five minutes, memory and disk), so opening the profile next costs
 * no second request, and they are only asked for once the top result has stayed the same for a
 * moment, not on every keystroke.
 */

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

/** The field's height, and its gap above the tab bar (at rest) or the keyboard (while typing). */
const FIELD_HEIGHT = 50;
const FIELD_GAP_ABOVE_BAR = 10;
const FIELD_GAP_ABOVE_KEYBOARD = 8;

/** How many of the top result's posts to show. */
const PREVIEW_POST_LIMIT = 3;
/**
 * How long the top result must stay the same before its posts are asked for. Typing a name changes
 * the top result on most keystrokes; each distinct person is a Worker request, so only the one the
 * user stops on is fetched.
 */
const PREVIEW_SETTLE_MS = 700;

type AppTheme = ReturnType<typeof useTheme>;

const isAnimated = (u: string) => /\.gif(\?|$)/i.test(u) || /giphy\.com|tenor\.com/i.test(u);

/**
 * Lower is better: the exact handle or name, then a prefix of either, then the start of a word in the
 * name, then anywhere. Without it the first result was whichever match came first in the directory,
 * which made "the top result" (and its posts) arbitrary.
 */
function matchRank(usernameLc: string, displayNameLc: string, q: string): number {
  if (usernameLc === q || displayNameLc === q) return 0;
  if (usernameLc.startsWith(q) || displayNameLc.startsWith(q)) return 1;
  if (displayNameLc.split(/\s+/).some((w) => w.startsWith(q))) return 2;
  return 3;
}

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
      style={({ pressed }) => [{ width: RECENT_TILE_WIDTH, alignItems: 'center' }, pressed ? { opacity: 0.7 } : null]}
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
// row when its `item` actually changes.
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
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          paddingVertical: 12,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.colors.border.light,
        },
        pressed ? { opacity: 0.7 } : null,
      ]}
    >
      <Avatar emoji={item.emoji} name={item.display_name || item.username} size="md" tint />
      <View style={{ marginLeft: 12, flex: 1, overflow: 'hidden' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
          <Text variant="body" weight="semibold" numberOfLines={1} style={{ flexShrink: 1 }}>{item.display_name}</Text>
          {item.is_verified && <VerifiedBadge size={12} />}
          {item.badge && <UserBadge badge={item.badge} size="sm" />}
        </View>
        <Text variant="caption" color={theme.colors.text.secondary} numberOfLines={1}>@{item.username}</Text>
      </View>
      <MaterialIcons name="chevron-right" size={18} color={theme.colors.text.tertiary} />
    </Pressable>
  );
});

function openPost(id: string) {
  Keyboard.dismiss();
  triggerHaptic('light');
  // `/comments/[id]` IS the post screen in this app; there is no `/post/[id]`.
  router.push({ pathname: '/comments/[id]', params: { id } });
}

/** One of the top result's latest posts: its first photo (if any), two or three lines, and when. */
const PreviewPostCard = memo(function PreviewPostCard({ post }: { post: ProfilePost }) {
  const theme = useTheme();
  const t = useT();
  const ago = useShortAgo();
  const thumb = useMemo(() => parseImageUrls(post.image_url).find((u) => !isAnimated(u)) || null, [post.image_url]);
  const text = stripMarkers(post.content) || (thumb ? t('chat.photo') : '—');
  return (
    <Pressable
      onPress={() => openPost(post.id)}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.postCard,
        { backgroundColor: theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.035)' },
        pressed ? { opacity: 0.75 } : null,
      ]}
    >
      {thumb ? (
        <View style={styles.postThumb}>
          <CachedImage uri={thumb} style={StyleSheet.absoluteFill as any} resizeMode="cover" proxyWidth={56} priority="low" />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text variant="caption" numberOfLines={thumb ? 2 : 3} style={{ fontSize: 13, lineHeight: 17 }}>{text}</Text>
        <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 11, marginTop: 4 }}>{ago(post.created_at)}</Text>
      </View>
    </Pressable>
  );
});

/** The latest posts under the top result. Nothing at all until there is something to show. */
const TopResultPosts = memo(function TopResultPosts({ profileId }: { profileId: string }) {
  const theme = useTheme();
  const t = useT();
  const blocked = useIsBlocked(profileId);
  const { posts } = useProfilePosts(blocked ? undefined : profileId);
  const latest = posts.slice(0, PREVIEW_POST_LIMIT);
  if (blocked || latest.length === 0) return null;
  return (
    <View style={styles.previewWrap}>
      <Text variant="caption" weight="semibold" color={theme.colors.text.tertiary} style={styles.previewLabel}>
        {t('search.latest_posts')}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.previewRow}
      >
        {latest.map((p) => <PreviewPostCard key={p.id} post={p} />)}
      </ScrollView>
    </View>
  );
});

/** The first result, as a card: a bigger row, and that person's latest posts once the result has settled. */
const TopResultCard = memo(function TopResultCard({
  item,
  showPosts,
  onSelect,
}: {
  item: ProfileResult;
  showPosts: boolean;
  onSelect: (item: ProfileResult) => void;
}) {
  const theme = useTheme();
  const hairline = theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
  return (
    <View style={[styles.topCard, { backgroundColor: theme.colors.background.elevated, borderColor: hairline }]}>
      <Pressable onPress={() => onSelect(item)} style={({ pressed }) => [styles.topRow, pressed ? { opacity: 0.7 } : null]}>
        <Avatar emoji={item.emoji} name={item.display_name || item.username} size="lg" tint />
        <View style={{ marginLeft: 14, flex: 1, overflow: 'hidden' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text variant="body" weight="bold" numberOfLines={1} style={{ flexShrink: 1, fontSize: 17 }}>{item.display_name || item.username}</Text>
            {item.is_verified ? <VerifiedBadge size={14} /> : null}
            {item.badge ? <UserBadge badge={item.badge} size="sm" /> : null}
          </View>
          <Text variant="caption" color={theme.colors.text.secondary} numberOfLines={1} style={{ marginTop: 2 }}>@{item.username}</Text>
        </View>
        <MaterialIcons name="chevron-right" size={20} color={theme.colors.text.tertiary} />
      </Pressable>
      {/* Keyed on the person: a fresh hook instance per profile, so one person's posts can never
          show under another's name while the next page loads. */}
      {showPosts ? <TopResultPosts key={item.id} profileId={item.id} /> : null}
    </View>
  );
});

/**
 * The field. Liquid glass where the material exists (iOS 26 with glass on), the same capsule the
 * chat composer uses; an elevated pill with a hairline border and a soft shadow everywhere else.
 */
const SearchField = memo(function SearchField({
  value,
  onChangeText,
  onClear,
  placeholder,
  clearLabel,
  glassActive,
  theme,
}: {
  value: string;
  onChangeText: (s: string) => void;
  onClear: () => void;
  placeholder: string;
  clearLabel: string;
  glassActive: boolean;
  theme: AppTheme;
}) {
  const [focused, setFocused] = useState(false);
  const scheme = theme.isDark ? 'dark' : 'light';
  const content = (
    <>
      <Feather name="search" size={18} color={focused ? theme.colors.accent.primary : theme.colors.text.tertiary} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.text.tertiary}
        accessibilityLabel={placeholder}
        style={[styles.fieldInput, { color: theme.colors.text.primary }]}
        selectionColor={theme.colors.accent.primary}
        keyboardAppearance={theme.isDark ? 'dark' : 'light'}
        returnKeyType="search"
        autoCorrect={false}
        autoCapitalize="none"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      {value.length > 0 ? (
        <Pressable
          onPress={onClear}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={clearLabel}
          style={[styles.fieldClear, { backgroundColor: theme.isDark ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.10)' }]}
        >
          <Feather name="x" size={13} color={theme.colors.text.secondary} />
        </Pressable>
      ) : null}
    </>
  );
  return glassActive ? (
    <NativeGlassView glassStyle="regular" colorScheme={scheme} style={styles.fieldBody}>
      {content}
    </NativeGlassView>
  ) : (
    <View
      style={[
        styles.fieldBody,
        styles.fieldFlat,
        {
          backgroundColor: theme.colors.background.elevated,
          borderColor: focused ? theme.colors.accent.primary + '66' : theme.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.08)',
        },
      ]}
    >
      {content}
    </View>
  );
});

export default function SearchScreen() {
  useScreenMountMark('(tabs)/search');
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  // Android: while this tab is focused the window does not resize for the keyboard; the field lifts
  // itself (below), as the chat composer does. Restored on blur. No-op on iOS.
  useChatKeyboardMode();
  const { height: keyboardHeight } = useReanimatedKeyboardAnimation();
  const glassActive = useLiquidGlassActive();
  const focused = useIsFocused();
  const [query, setQuery] = useState('');
  // Debounced mirror of `query`. The text input stays fully controlled by
  // `query` (responsive on every keystroke); only the heavy profile filter
  // reads `debouncedQuery`, so the directory scan runs at most once per
  // ~160 ms idle window instead of on every keystroke. See the debounce
  // effect below.
  const [debouncedQuery, setDebouncedQuery] = useState('');
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

  // Deferred full hydrate of the cached profile directory: the heavy JSON.parse of the entire
  // `@san:all_profiles` blob runs off the mount frame. Uses a functional setState so it won't
  // clobber fresher data already set by the network refresh in loadProfiles().
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
  }, []);

  // Debounce `query` → `debouncedQuery`. Keeps the input responsive while
  // collapsing bursts of keystrokes into a single filter pass.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query), 160);
    return () => clearTimeout(id);
  }, [query]);

  // Get mini-apps from store (reactive)
  const miniApps = useMiniAppsStore((s) => s.apps);

  // Prebuilt lowercase search index. Lowercasing each profile's username and
  // display name ONCE here (recomputed only when `allProfiles` changes) means
  // the per-search filter does cheap includes() against precomputed strings.
  const searchIndex = useMemo(
    () =>
      allProfiles.map((p) => ({
        profile: p,
        username_lc: (p.username || '').toLowerCase(),
        display_name_lc: (p.display_name || '').toLowerCase(),
      })),
    [allProfiles]
  );

  // Derived in render rather than copied into state by an effect, which cost a second render per
  // settled query. Ranked, so the top result is the best match rather than the first one found.
  const profiles = useMemo<ProfileResult[]>(() => {
    const term = debouncedQuery.startsWith('#') || debouncedQuery.startsWith('@') ? debouncedQuery.slice(1) : debouncedQuery;
    const lower = term.trim().toLowerCase();
    if (!lower) return [];
    const hits: { profile: ProfileResult; rank: number; i: number }[] = [];
    searchIndex.forEach((e, i) => {
      if (e.username_lc.includes(lower) || e.display_name_lc.includes(lower)) {
        hits.push({ profile: e.profile, rank: matchRank(e.username_lc, e.display_name_lc, lower), i });
      }
    });
    hits.sort((a, b) => a.rank - b.rank || a.i - b.i);
    return hits.map((h) => h.profile);
  }, [debouncedQuery, searchIndex]);

  // ── THE ONE SPINNER IN THE APP WITH NO WAY OUT ────────────────────────────
  //
  // `loadProfiles()` is called bare from the mount effect above — no `.catch` — so a rejection
  // from the sync must still clear `isLoading`, or a full-screen spinner covers the results for the
  // life of the screen. `finally` is the fix: every exit from this function means "we are no longer
  // loading", including the throttle short-circuit.
  const loadProfiles = async () => {
    // Only gate the UI behind a spinner when we have nothing cached to show.
    let hasCache = false;
    try {
      const raw = kvGetStringRawSync('@san:all_profiles');
      hasCache = !!(raw && raw.length > 2);
    } catch {}
    if (!hasCache) setIsLoading(true);
    try {
      // `syncProfiles` rather than a fetch of its own: the messages tab already runs it on mount,
      // against the same endpoint, under its own 15-minute stamp. One shared stamp, and the result
      // is read from the entity store it fills.
      await syncProfiles();
      const known = Object.values(useEntityStore.getState().profiles || {});
      if (known.length > 0) {
        setAllProfiles(
          known.map((p: any) => ({
            id: p.id,
            username: p.username,
            display_name: p.display_name,
            emoji: p.emoji,
            bio: p.bio || '',
            badge: p.badge || undefined,
            is_verified: !!p.is_verified,
          })),
        );
      }
    } finally {
      setIsLoading(false);
    }
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
    triggerHaptic('light');
    setHistory([]);
    setRecentApps([]);
    await AsyncStorage.multiRemove([accountKey(SEARCH_HISTORY_KEY), accountKey(RECENT_APPS_KEY)]);
  };

  const handleSelect = useCallback((item: ProfileResult) => {
    Keyboard.dismiss();
    addToHistory(item);
    router.push({ pathname: '/profile/[id]', params: { id: item.id } });
  }, [addToHistory]);

  const openApp = useCallback((app: { id: string; name: string; emoji: string; url: string }) => {
    Keyboard.dismiss();
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

  // No `paddingTop` here: the floating header below owns the inset, exactly as on the chat list, so
  // the two tabs share one top edge, one title row and one fade.
  const containerStyle = useMemo<ViewStyle>(() => ({
    flex: 1,
    backgroundColor: theme.colors.background.primary,
  }), [theme]);
  const { content: headerContentHeight, gradient: headerGradientHeight } = headerScrimHeights(insets.top);

  // ── The field's place ─────────────────────────────────────────────────────
  // At rest it floats just above the tab bar. With the keyboard up it sits just above the keyboard:
  // the lift is whatever the keyboard covers beyond the field's resting height, read every frame on
  // the UI thread, so the field moves with the keyboard rather than after it.
  const restBottom = getTabBarHeight(insets.bottom) + FIELD_GAP_ABOVE_BAR;
  const fieldLiftStyle = useAnimatedStyle(() => {
    const kb = Math.abs(keyboardHeight.value);
    return { transform: [{ translateY: -Math.max(0, kb + FIELD_GAP_ABOVE_KEYBOARD - restBottom) }] };
  }, [restBottom]);

  // The list's bottom padding has to clear the field, and while typing the keyboard as well. A
  // layout value, so it follows the keyboard's final height (set once per show / hide), not every
  // animation frame.
  const [keyboardOpenHeight, setKeyboardOpenHeight] = useState(0);
  useEffect(() => {
    if (!focused) return;
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvt, (e) => setKeyboardOpenHeight(e?.endCoordinates?.height ?? 0));
    const hide = Keyboard.addListener(hideEvt, () => setKeyboardOpenHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, [focused]);
  const fieldTop = Math.max(restBottom, keyboardOpenHeight + FIELD_GAP_ABOVE_KEYBOARD) + FIELD_HEIGHT;

  // ── The top result's posts ────────────────────────────────────────────────
  // Asked for only once the same person has stayed on top for PREVIEW_SETTLE_MS (see there).
  const topId = profiles.length > 0 ? profiles[0].id : null;
  const [settledTopId, setSettledTopId] = useState<string | null>(null);
  useEffect(() => {
    if (!topId) { setSettledTopId(null); return; }
    const timer = setTimeout(() => setSettledTopId(topId), PREVIEW_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [topId]);

  // Stable list props so FlatList doesn't see new identities each keystroke.
  const keyExtractor = useCallback((item: ProfileResult) => item.id, []);
  const restOfResults = useMemo(() => profiles.slice(1), [profiles]);

  const renderItem = useCallback(
    ({ item }: { item: ProfileResult }) => (
      <SearchResultRow item={item} theme={theme} onSelect={handleSelect} />
    ),
    [theme, handleSelect]
  );

  const listContentStyle = useMemo(() => ({
    paddingHorizontal: theme.spacing.base,
    paddingTop: headerContentHeight + 8,
    paddingBottom: fieldTop + 20,
  }), [theme, headerContentHeight, fieldTop]);

  // The strip's own padding. `base - 6` because each tile is centred inside RECENT_TILE_WIDTH,
  // so the first avatar already carries ~6 pt of its own slack; using the full base inset
  // would leave the row visibly further from the edge than the heading above it.
  const recentStripStyle = useMemo(() => ({
    paddingHorizontal: theme.spacing.base - 6,
  }), [theme]);

  // Mini apps are their OWN category, rendered as the list FOOTER rather than mixed in above the
  // people, so a query that hits both never pushes the person the user is looking for down.
  const matchedApps = useMemo(() => {
    const term = debouncedQuery.startsWith('#') ? debouncedQuery.slice(1) : debouncedQuery;
    const lower = term.trim().toLowerCase();
    if (!lower) return [];
    return miniApps.filter(
      (a) => a.name.toLowerCase().includes(lower) || (a.description || '').toLowerCase().includes(lower),
    );
  }, [debouncedQuery, miniApps]);

  const listHeader = useMemo(() => {
    if (profiles.length === 0) return null;
    return (
      <View>
        <Text variant="caption" weight="semibold" color={theme.colors.text.secondary} style={styles.sectionLabel}>
          {t('search.people')}
        </Text>
        <TopResultCard item={profiles[0]} showPosts={settledTopId === profiles[0].id} onSelect={handleSelect} />
      </View>
    );
  }, [profiles, settledTopId, theme, t, handleSelect]);

  const listFooter = useMemo(() => {
    if (matchedApps.length === 0) return null;
    return (
      <View style={{ marginTop: 18 }}>
        <Text variant="caption" weight="semibold" color={theme.colors.text.secondary} style={styles.sectionLabel}>{t('search.mini_apps')}</Text>
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

  // Only when nothing matched at all: the top result is the header, so an empty `restOfResults`
  // alone does not mean "no results".
  const listEmpty = useMemo(() => (
    profiles.length > 0 || matchedApps.length > 0 ? null : (
      <View style={{ alignItems: 'center', paddingTop: 40 }}>
        <Text variant="body" color={theme.colors.text.tertiary}>{t('search.empty')}</Text>
      </View>
    )
  ), [profiles.length, matchedApps.length, theme, t]);

  const hasQuery = query.trim().length > 0;
  const showRecents = !hasQuery && recents.length > 0;

  const clearQuery = useCallback(() => setQuery(''), []);

  return (
    <View style={containerStyle}>
      {/* Results first, so the header's fade and the field paint over them. */}
      {isLoading && !showRecents ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={theme.colors.accent.primary} />
        </View>
      ) : hasQuery ? (
        <FlatList
          data={restOfResults}
          keyExtractor={keyExtractor}
          contentContainerStyle={listContentStyle}
          // The keyboard is up whenever the user is typing, so the first tap on a result must land
          // on it rather than only closing the keyboard; a drag puts the keyboard away.
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
          // A username search that matches a large slice of the directory must not mount every row
          // at once on each keystroke.
          removeClippedSubviews={true}
          initialNumToRender={10}
          maxToRenderPerBatch={8}
          windowSize={7}
          renderItem={renderItem}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={listEmpty}
          // Mini apps as their own trailing category — see `listFooter`.
          ListFooterComponent={listFooter}
        />
      ) : (
        <View style={{ flex: 1, paddingTop: headerContentHeight + 4 }}>
          {/* ── Recent ──────────────────────────────────────────────────────────
              A HORIZONTAL strip of round avatars with the name underneath, people and mini apps
              together, newest first: shortcuts, not a second set of results. At the top, under
              the same fade as the title, with the field at the bottom of the screen. */}
          {showRecents ? (
            <View style={{ paddingTop: 14 }}>
              <View style={[styles.recentHead, { paddingHorizontal: theme.spacing.base }]}>
                <Text variant="subheading" weight="bold">{t('search.recent')}</Text>
                <Pressable
                  onPress={clearHistory}
                  hitSlop={10}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.clearPill,
                    { backgroundColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' },
                    pressed ? { opacity: 0.7 } : null,
                  ]}
                >
                  <Text variant="caption" weight="medium" color={theme.colors.text.secondary}>{t('search.clear')}</Text>
                </Pressable>
              </View>
              <FlatList
                data={recents}
                horizontal
                showsHorizontalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                keyExtractor={recentKeyExtractor}
                renderItem={renderRecent}
                contentContainerStyle={recentStripStyle}
                initialNumToRender={6}
                maxToRenderPerBatch={4}
                windowSize={3}
                removeClippedSubviews={true}
              />
            </View>
          ) : !isLoading ? (
            // Nothing typed and nothing recent: say what this screen is for instead of a blank page.
            <View style={styles.hint}>
              <View style={[styles.hintIcon, { backgroundColor: theme.colors.accent.primary + '1F' }]}>
                <MaterialIcons name="person-search" size={30} color={theme.colors.accent.primary} />
              </View>
              <Text variant="body" weight="semibold" align="center" style={{ marginTop: 14 }}>{t('search.hint_title')}</Text>
              <Text variant="caption" color={theme.colors.text.tertiary} align="center" style={{ marginTop: 6, lineHeight: 18 }}>
                {t('search.hint_body')}
              </Text>
            </View>
          ) : null}
        </View>
      )}

      {/* Floating title row over the same top fade as the chat list. */}
      <View style={[styles.header, { height: headerGradientHeight }]} pointerEvents="box-none">
        <LinearGradient
          colors={topScrimColors(theme.isDark, theme.colors.background.primary)}
          locations={SCRIM_LOCATIONS}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <View style={[styles.headerRow, { paddingTop: insets.top + 8 }]} pointerEvents="none">
          <Text variant="subheading" weight="bold" numberOfLines={1}>{t('search.title')}</Text>
        </View>
      </View>

      {/* The field, above the tab bar, riding up with the keyboard. */}
      <Reanimated.View style={[styles.fieldDock, { bottom: restBottom }, fieldLiftStyle]} pointerEvents="box-none">
        <SearchField
          value={query}
          onChangeText={setQuery}
          onClear={clearQuery}
          placeholder={t('search.placeholder')}
          clearLabel={t('search.clear_query')}
          glassActive={glassActive}
          theme={theme}
        />
      </Reanimated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 100 },
  headerRow: { alignItems: 'center', justifyContent: 'center', paddingBottom: 8, height: '100%' },
  hint: { alignItems: 'center', paddingHorizontal: 40, paddingTop: 72 },
  hintIcon: { width: 64, height: 64, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  recentHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  clearPill: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 12 },
  sectionLabel: { marginBottom: 8, marginTop: 4 },
  topCard: { borderRadius: 24, borderWidth: 1, marginBottom: 8, overflow: 'hidden' },
  topRow: { flexDirection: 'row', alignItems: 'center', padding: 14 },
  previewWrap: { paddingBottom: 14 },
  previewLabel: { paddingHorizontal: 14, marginBottom: 8, fontSize: 12 },
  previewRow: { paddingHorizontal: 14, gap: 10 },
  postCard: { width: 220, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 18 },
  postThumb: { width: 56, height: 56, borderRadius: 12, overflow: 'hidden' },
  fieldDock: { position: 'absolute', left: 16, right: 16, zIndex: 120 },
  fieldBody: {
    height: FIELD_HEIGHT,
    borderRadius: FIELD_HEIGHT / 2,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 16,
    paddingRight: 12,
    gap: 10,
  },
  fieldFlat: {
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.16,
    shadowRadius: 14,
    elevation: 6,
  },
  fieldInput: { flex: 1, fontSize: 16, paddingVertical: 0, height: FIELD_HEIGHT },
  fieldClear: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
});
