import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  View,
  Pressable,
  FlatList,
  Dimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
  InteractionManager,
  ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { ProfileThemePreviewCard } from '../../src/components/profile/ProfileThemePreviewCard';
import {
  BUILT_IN_THEME_LIST,
  DEFAULT_THEME_ID,
  isKnownThemeId,
  type ProfileTheme,
} from '../../src/theme/profileThemes';
import { useProfileThemeStore, useActiveProfileThemeId } from '../../src/store/profileThemeStore';
import { persistThemeSelection } from '../../src/store/profileThemeCommit';
import { useAuthStore } from '../../src/store/authStore';
import { updateProfile as updateSupabaseProfile } from '../../src/lib/supabase';
import { showToast } from '../../src/store/toastStore';
import { useT } from '../../src/i18n/store';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = SCREEN_WIDTH * 0.62;
const CARD_GAP = 12;

/**
 * Theme_Selection_Screen — `app/settings/profile-theme.tsx`.
 *
 * Mirrors `app/settings/appearance.tsx` precisely (Req 2, 9.4): a header with
 * back + Save, an `InteractionManager`-deferred `cardsReady` gate so the
 * carousel mounts after the navigation transition, and a tightly-virtualized
 * horizontal `FlatList` over the Built_In_Theme_Set so the open-screen frame
 * stays under the perf monitor's long-task threshold (Req 2.7).
 *
 * On confirm it does an optimistic per-account `setThemeId`, then persists via
 * `PATCH /v1/profiles/me { theme_id }` raced against a 5 s timeout; on
 * rejection / timeout / `invalid_theme_id` it reverts to the previously
 * persisted id and surfaces an error toast (Req 2.4–2.6, 3.7, 3.8).
 */
export default function ProfileThemeScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();

  const user = useAuthStore((s) => s.user);
  const commitAuthProfile = useAuthStore((s) => s.updateProfile);
  const accountId = user?.id ?? '';

  const setThemeId = useProfileThemeStore((s) => s.setThemeId);
  const revertThemeId = useProfileThemeStore((s) => s.revertThemeId);

  // Currently persisted Theme_Id for the active account: the per-account
  // optimistic/persisted mirror first, then the user row's `themeId`, then the
  // Default_Theme when nothing is stored (Req 2.2, 2.3).
  const storedThemeId = useActiveProfileThemeId(accountId);
  const persistedId = storedThemeId ?? user?.themeId ?? DEFAULT_THEME_ID;
  const selectedThemeId = isKnownThemeId(persistedId) ? persistedId : DEFAULT_THEME_ID;

  const initialIndex = Math.max(
    0,
    BUILT_IN_THEME_LIST.findIndex((tm) => tm.id === selectedThemeId),
  );

  const scrollRef = useRef<FlatList<ProfileTheme>>(null);
  const [activeIndex, setActiveIndex] = useState(initialIndex);

  // Defer the carousel past the navigation slide-in. Each preview card mounts a
  // gradient + image + emoji glyphs; mounting all six synchronously on the open
  // frame is exactly the long task `appearance.tsx` avoids the same way (Req
  // 2.7, 9.4). A faint spinner reads as "cards about to slide in".
  const [cardsReady, setCardsReady] = useState(false);
  useEffect(() => {
    const handle = InteractionManager.runAfterInteractions(() => setCardsReady(true));
    return () => handle.cancel();
  }, []);

  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = e.nativeEvent.contentOffset.x;
    const index = Math.round(x / (CARD_WIDTH + CARD_GAP));
    setActiveIndex(Math.max(0, Math.min(index, BUILT_IN_THEME_LIST.length - 1)));
  }, []);

  // Stable getItemLayout — required for scrollToIndex on a horizontal FlatList
  // and lets the list skip layout measurement entirely (mirrors appearance.tsx).
  const getItemLayout = useCallback(
    (_: ArrayLike<ProfileTheme> | null | undefined, index: number) => ({
      length: CARD_WIDTH + CARD_GAP,
      offset: (CARD_WIDTH + CARD_GAP) * index,
      index,
    }),
    [],
  );

  const renderTheme = useCallback(
    ({ item, index }: { item: ProfileTheme; index: number }) => (
      <View style={{ marginRight: CARD_GAP }}>
        <ProfileThemePreviewCard
          theme={item}
          isSelected={index === activeIndex}
          width={CARD_WIDTH}
          onPress={() => {
            setActiveIndex(index);
            try {
              scrollRef.current?.scrollToIndex({ index, animated: true });
            } catch {}
          }}
        />
      </View>
    ),
    [activeIndex],
  );

  const handleSave = useCallback(() => {
    const selected = BUILT_IN_THEME_LIST[activeIndex];
    if (!selected || !accountId) {
      router.back();
      return;
    }

    const nextId = selected.id;
    // Nothing changed — just leave.
    if (nextId === selectedThemeId) {
      router.back();
      return;
    }

    // Capture the previously persisted id BEFORE the optimistic write so we can
    // revert to the exact prior value (which may be `undefined`) on failure.
    const prevStored = useProfileThemeStore.getState().getThemeId(accountId);

    // Optimistic per-account commit + persistence race, extracted into the pure
    // `persistThemeSelection` helper (design Property 13). The optimistic
    // `setThemeId` runs synchronously inside the helper before the first await,
    // so the displayed selection updates before we navigate away (Req 2.4); on
    // reject / timeout / invalid_theme_id it reverts to the previously persisted
    // id and surfaces an error toast (Req 2.5, 2.6, 3.7, 3.8).
    const settled = persistThemeSelection({
      accountId,
      nextId,
      prevId: prevStored,
      persist: (id, themeId) => updateSupabaseProfile(id, { theme_id: themeId }),
      setThemeId,
      revertThemeId,
      onSuccess: (id) => commitAuthProfile({ themeId: id }),
      onError: () =>
        showToast(
          t('profileTheme.save_error', 'Не удалось сохранить тему'),
          'alert-triangle',
        ),
    });

    router.back();
    void settled;
  }, [activeIndex, accountId, selectedThemeId, setThemeId, revertThemeId, commitAuthProfile, t]);

  // Auto-center on the persisted theme once the cards mount (O(1) via getItemLayout).
  useEffect(() => {
    if (!cardsReady || initialIndex <= 0) return;
    const id = setTimeout(() => {
      try {
        scrollRef.current?.scrollToIndex({ index: initialIndex, animated: false });
      } catch {}
    }, 100);
    return () => clearTimeout(id);
  }, [cardsReady, initialIndex]);

  const currentTheme = BUILT_IN_THEME_LIST[activeIndex];

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>
      {/* Header */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 20,
          paddingTop: insets.top + 8,
          paddingBottom: 12,
        }}
      >
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Feather name="chevron-left" size={24} color={theme.colors.text.primary} />
        </Pressable>
        <Text variant="body" weight="bold">
          {t('profileTheme.title', 'Тема профиля')}
        </Text>
        <Pressable onPress={handleSave} hitSlop={8}>
          <Text variant="body" weight="semibold" color={theme.colors.accent.primary}>
            {t('common.save')}
          </Text>
        </Pressable>
      </View>

      {/* Cards carousel — deferred + virtualized exactly like appearance.tsx so
          only ~3 of the six previews are mounted at once and the open frame
          stays under the long-task threshold (Req 2.7, 9.4). */}
      <View style={{ flex: 1, justifyContent: 'center' }}>
        {cardsReady ? (
          <FlatList
            ref={scrollRef}
            data={BUILT_IN_THEME_LIST}
            keyExtractor={(tm) => tm.id}
            horizontal
            pagingEnabled={false}
            snapToInterval={CARD_WIDTH + CARD_GAP}
            decelerationRate="fast"
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{
              paddingHorizontal: (SCREEN_WIDTH - CARD_WIDTH) / 2,
              alignItems: 'center',
            }}
            onScroll={handleScroll}
            scrollEventThrottle={16}
            renderItem={renderTheme}
            getItemLayout={getItemLayout}
            initialNumToRender={2}
            maxToRenderPerBatch={1}
            windowSize={3}
            removeClippedSubviews
            initialScrollIndex={initialIndex}
          />
        ) : (
          <View
            style={{
              alignItems: 'center',
              justifyContent: 'center',
              height: CARD_WIDTH * 1.3,
            }}
          >
            <ActivityIndicator size="small" color={theme.colors.text.tertiary} />
          </View>
        )}

        {/* Dots indicator */}
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'center',
            alignItems: 'center',
            marginTop: 20,
            gap: 6,
          }}
        >
          {BUILT_IN_THEME_LIST.map((tm, index) => (
            <View
              key={tm.id}
              style={{
                width: index === activeIndex ? 20 : 6,
                height: 6,
                borderRadius: 3,
                backgroundColor:
                  index === activeIndex ? tm.palette.accent : theme.colors.border.light,
              }}
            />
          ))}
        </View>

        {/* Active theme name */}
        <View
          style={{
            alignItems: 'center',
            justifyContent: 'center',
            marginTop: 16,
            marginBottom: 24,
          }}
        >
          <Text variant="body" weight="bold" align="center">
            {currentTheme?.label ?? ''}
          </Text>
        </View>
      </View>
    </View>
  );
}
