import React, { useRef, useState, useEffect } from 'react';
import { View, Pressable, ScrollView, Dimensions, NativeSyntheticEvent, NativeScrollEvent, Alert, InteractionManager, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { VerifiedBadge } from '../../src/components/ui/VerifiedBadge';
import { useThemeStore, ACCENT_COLORS, AccentColor } from '../../src/store/themeStore';
import { useAuthStore } from '../../src/store/authStore';
import { useSettingsStore } from '../../src/store/settingsStore';
import { useT } from '../../src/i18n/store';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = SCREEN_WIDTH * 0.72;
const CARD_GAP = 12;

function ThemePreviewCardBase({ accentConfig, isDark, isSelected, user, t, previewMessage, previewUser }: { accentConfig: typeof ACCENT_COLORS[0]; isDark: boolean; isSelected: boolean; user: any; t: (key: string, fallback?: string, vars?: Record<string, string | number>) => string; previewMessage: string; previewUser: string }) {
  const bgPrimary = isDark ? accentConfig.darkBg : accentConfig.light;
  const bgElevated = isDark ? accentConfig.darkElevated : '#FFFFFF';
  const textPrimary = isDark ? '#FFFFFF' : '#1A1A1A';
  const textSecondary = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)';
  const borderColor = isDark ? accentConfig.darkBorder : accentConfig.color + '25';
  const accent = accentConfig.color;

  return (
    <View style={{
      width: CARD_WIDTH,
      borderRadius: 24,
      overflow: 'hidden',
      backgroundColor: bgPrimary,
      borderWidth: isSelected ? 2.5 : 1,
      borderColor: isSelected ? accent : borderColor,
      shadowColor: isSelected ? accent : '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: isSelected ? 0.3 : 0.1,
      shadowRadius: 12,
      elevation: isSelected ? 8 : 3,
    }}>
      {/* Mini header */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingTop: 14, paddingBottom: 6 }}>
        <Text style={{ fontSize: 14, fontWeight: '700', color: textPrimary }}>San</Text>
        <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: accent, alignItems: 'center', justifyContent: 'center' }}>
          <Feather name="bell" size={8} color="#FFF" />
        </View>
      </View>

      {/* Mini post card */}
      <View style={{ marginHorizontal: 10, marginVertical: 6, backgroundColor: bgElevated, borderRadius: 16, padding: 10, borderWidth: 0.5, borderColor: borderColor }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
          <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: accent + '20', alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 12 }}>{user?.emoji || '😊'}</Text>
          </View>
          <View style={{ marginLeft: 8, flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <Text style={{ fontSize: 10, fontWeight: '600', color: textPrimary, flexShrink: 1 }} numberOfLines={1}>{user?.displayName || 'User'}</Text>
              {user?.is_verified && <VerifiedBadge size={9} />}
            </View>
            <Text style={{ fontSize: 7, color: textSecondary }}>2m ago</Text>
          </View>
        </View>
        <Text style={{ fontSize: 9, color: textSecondary, marginBottom: 6 }} numberOfLines={2}>{previewMessage}</Text>
        <View style={{ height: 55, borderRadius: 10, backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' }} />
        <View style={{ flexDirection: 'row', marginTop: 6, gap: 12 }}>
          <Feather name="heart" size={10} color={accent} />
          <Feather name="message-circle" size={10} color={textSecondary} />
          <Feather name="repeat" size={10} color={textSecondary} />
        </View>
      </View>

      {/* Mini second post preview */}
      <View style={{ marginHorizontal: 10, marginBottom: 6, backgroundColor: bgElevated, borderRadius: 16, padding: 10, borderWidth: 0.5, borderColor: borderColor }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: accent + '20', alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 12 }}>🌸</Text>
          </View>
          <View style={{ marginLeft: 8 }}>
            <Text style={{ fontSize: 10, fontWeight: '600', color: textPrimary }}>{previewUser}</Text>
            <Text style={{ fontSize: 7, color: textSecondary }}>15m ago</Text>
          </View>
        </View>
      </View>

      {/* Mini tab bar */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 8, borderTopWidth: 0.5, borderTopColor: borderColor }}>
        <Feather name="home" size={12} color={accent} />
        <Feather name="search" size={12} color={textSecondary} />
        <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: accent, alignItems: 'center', justifyContent: 'center' }}>
          <Feather name="plus" size={9} color="#FFF" />
        </View>
        <Feather name="send" size={12} color={textSecondary} />
        <Feather name="user" size={12} color={textSecondary} />
      </View>

      {/* Theme label */}
      <View style={{ alignItems: 'center', paddingVertical: 8, backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)' }}>
        <Text style={{ fontSize: 11, fontWeight: '600', color: accent }}>{accentConfig.key.startsWith('ai-') ? accentConfig.label : t(`theme.color.${accentConfig.key}`, accentConfig.label)}</Text>
      </View>
    </View>
  );
}

// Memoized so scrolling (which updates activeIndex on the parent) only re-renders
// the two cards whose selected-state actually changed — not the whole carousel.
const ThemePreviewCard = React.memo(ThemePreviewCardBase, (prev, next) =>
  prev.isSelected === next.isSelected &&
  prev.isDark === next.isDark &&
  prev.accentConfig.key === next.accentConfig.key &&
  prev.user === next.user &&
  prev.previewMessage === next.previewMessage &&
  prev.previewUser === next.previewUser
);

export default function AppearanceScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  const previewMessage = t('appearance.preview_message');
  const previewUser = t('appearance.preview_user');
  const { mode, accent, setAccent, aiThemes } = useThemeStore();
  const removeAiTheme = (key: string) => useThemeStore.setState((s) => ({ aiThemes: s.aiThemes.filter(t => t.key !== key) }));
  const { user } = useAuthStore();
  const isDark = mode === 'dark';
  const allThemes = [...ACCENT_COLORS, ...aiThemes];
  const scrollRef = useRef<ScrollView>(null);
  const [activeIndex, setActiveIndex] = useState(Math.max(0, allThemes.findIndex(c => c.key === accent)));

  // Defer the cards carousel past the navigation slide-in. Each ThemePreviewCard
  // mounts ~10 Feather icons + several Views; for 6+ themes that's a 60-icon
  // synchronous mount on the open-screen frame and was the dominant source of
  // the `LONG [settings] long task @ settings ~130ms` markers users were
  // seeing the moment they tapped "Appearance". Showing a flat placeholder
  // for the first ~300 ms feels like a regular slide-in completion; cards
  // pop in on the next frame.
  const [cardsReady, setCardsReady] = useState(false);
  useEffect(() => {
    const handle = InteractionManager.runAfterInteractions(() => setCardsReady(true));
    return () => handle.cancel();
  }, []);

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = e.nativeEvent.contentOffset.x;
    const index = Math.round(x / (CARD_WIDTH + CARD_GAP));
    setActiveIndex(Math.max(0, Math.min(index, allThemes.length - 1)));
  };

  const handleSave = () => {
    const selected = allThemes[activeIndex];
    if (selected) setAccent(selected.key);
    router.back();
  };

  // Auto-scroll to active theme on mount
  useEffect(() => {
    const idx = Math.max(0, allThemes.findIndex(c => c.key === accent));
    if (idx > 0 && scrollRef.current) {
      // Set initial position without animation, then no jarring scroll
      setTimeout(() => {
        scrollRef.current?.scrollTo({ x: idx * (CARD_WIDTH + CARD_GAP), animated: false });
      }, 100);
    }
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: insets.top + 8, paddingBottom: 12 }}>
        <Pressable onPress={() => router.back()}>
          <Feather name="chevron-left" size={24} color={theme.colors.text.primary} />
        </Pressable>
        <Text variant="body" weight="bold">{t('appearance.title')}</Text>
        <Pressable onPress={handleSave}>
          <Text variant="body" weight="semibold" color={theme.colors.accent.primary}>{t('common.save')}</Text>
        </Pressable>
      </View>

      {/* Cards carousel — gated past the navigation transition so the
          slide-in animation isn't competing with 60+ icon mounts. */}
      <View style={{ flex: 1, justifyContent: 'center' }}>
        {cardsReady ? (
          <ScrollView
            ref={scrollRef}
            horizontal
            pagingEnabled={false}
            snapToInterval={CARD_WIDTH + CARD_GAP}
            decelerationRate="fast"
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: (SCREEN_WIDTH - CARD_WIDTH) / 2, gap: CARD_GAP, alignItems: 'center' }}
            onScroll={handleScroll}
            scrollEventThrottle={16}
          >
            {allThemes.map((c, index) => (
              <ThemePreviewCard
                key={c.key}
                accentConfig={c}
                isDark={isDark}
                isSelected={index === activeIndex}
                user={user}
                t={t}
                previewMessage={previewMessage}
                previewUser={previewUser}
              />
            ))}
          </ScrollView>
        ) : (
          // Placeholder while we wait for the navigation transition to settle.
          // A faint spinner reads the same as "the cards are about to slide in"
          // and avoids a frozen blank gap.
          <View style={{ alignItems: 'center', justifyContent: 'center', height: CARD_WIDTH * 1.1 }}>
            <ActivityIndicator size="small" color={theme.colors.text.tertiary} />
          </View>
        )}

        {/* Dots indicator */}
        <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 20, gap: 6 }}>
          {allThemes.map((c, index) => (
            <View
              key={c.key}
              style={{
                width: index === activeIndex ? 20 : 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: index === activeIndex ? c.color : theme.colors.border.light,
              }}
            />
          ))}
        </View>

        {/* Theme name + delete for AI themes */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 16, marginBottom: 24, gap: 8 }}>
          <Text variant="body" weight="bold" align="center">
            {(() => {
              const cur = allThemes[activeIndex];
              if (!cur) return '';
              return cur.key.startsWith('ai-') ? cur.label : t(`theme.color.${cur.key}`, cur.label);
            })()}
          </Text>
          {allThemes[activeIndex]?.key.startsWith('ai-') && (
            <Pressable onPress={() => { const key = allThemes[activeIndex]?.key; if (key) { removeAiTheme(key); if (accent === key) setAccent('sage'); } }} style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(255,59,48,0.15)', alignItems: 'center', justifyContent: 'center' }}>
              <Feather name="trash-2" size={12} color="#FF3B30" />
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}
