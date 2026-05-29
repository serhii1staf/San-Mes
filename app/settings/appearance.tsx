import React, { useRef, useState } from 'react';
import { View, Pressable, ScrollView, Dimensions, NativeSyntheticEvent, NativeScrollEvent } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { useThemeStore, ACCENT_COLORS, FONT_FAMILIES, FONT_SIZES, AccentColor, FontFamily, FontSize } from '../../src/store/themeStore';
import { useAuthStore } from '../../src/store/authStore';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = SCREEN_WIDTH * 0.72;
const CARD_GAP = 12;

function ThemePreviewCard({ accentConfig, isDark, isSelected, user }: { accentConfig: typeof ACCENT_COLORS[0]; isDark: boolean; isSelected: boolean; user: any }) {
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
          <View style={{ marginLeft: 8 }}>
            <Text style={{ fontSize: 10, fontWeight: '600', color: textPrimary }}>{user?.displayName || 'User'}</Text>
            <Text style={{ fontSize: 7, color: textSecondary }}>2m ago</Text>
          </View>
        </View>
        <Text style={{ fontSize: 9, color: textSecondary, marginBottom: 6 }} numberOfLines={2}>Привет! Как дела сегодня? 🌟</Text>
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
            <Text style={{ fontSize: 10, fontWeight: '600', color: textPrimary }}>Мария</Text>
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
        <Text style={{ fontSize: 11, fontWeight: '600', color: accent }}>{accentConfig.label}</Text>
      </View>
    </View>
  );
}

export default function AppearanceScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { mode, accent, fontFamily: currentFont, fontSize: currentSize, setAccent, setFontFamily, setFontSize } = useThemeStore();
  const { user } = useAuthStore();
  const isDark = mode === 'dark';
  const scrollRef = useRef<ScrollView>(null);
  const [activeIndex, setActiveIndex] = useState(ACCENT_COLORS.findIndex(c => c.key === accent));

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = e.nativeEvent.contentOffset.x;
    const index = Math.round(x / (CARD_WIDTH + CARD_GAP));
    setActiveIndex(Math.max(0, Math.min(index, ACCENT_COLORS.length - 1)));
  };

  const handleSave = () => {
    const selected = ACCENT_COLORS[activeIndex];
    if (selected) setAccent(selected.key);
    router.back();
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: insets.top + 8, paddingBottom: 12 }}>
        <Pressable onPress={() => router.back()}>
          <Feather name="chevron-left" size={24} color={theme.colors.text.primary} />
        </Pressable>
        <Text variant="body" weight="bold">Внешний вид</Text>
        <Pressable onPress={handleSave}>
          <Text variant="body" weight="semibold" color={theme.colors.accent.primary}>Сохранить</Text>
        </Pressable>
      </View>

      {/* Cards carousel */}
      <View style={{ flex: 1, justifyContent: 'center' }}>
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
          {ACCENT_COLORS.map((c, index) => (
            <ThemePreviewCard
              key={c.key}
              accentConfig={c}
              isDark={isDark}
              isSelected={index === activeIndex}
              user={user}
            />
          ))}
        </ScrollView>

        {/* Dots indicator */}
        <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 20, gap: 6 }}>
          {ACCENT_COLORS.map((c, index) => (
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

        {/* Theme name below cards */}
        <Text variant="body" weight="bold" align="center" style={{ marginTop: 16 }}>
          {ACCENT_COLORS[activeIndex]?.label || ''}
        </Text>
        <Text variant="caption" color={theme.colors.text.tertiary} align="center" style={{ marginTop: 4, marginBottom: 24 }}>
          Пролистайте для выбора темы
        </Text>

        {/* Font & Size controls */}
        <View style={{ paddingHorizontal: 24 }}>
          {/* Font Size */}
          <Text variant="caption" weight="semibold" color={theme.colors.text.secondary} style={{ marginBottom: 8 }}>Размер текста</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 20 }}>
            {FONT_SIZES.map(f => (
              <Pressable key={f.key} onPress={() => setFontSize(f.key)} style={{ flex: 1, paddingVertical: 10, borderRadius: 12, backgroundColor: currentSize === f.key ? theme.colors.accent.primary + '20' : theme.colors.background.elevated, borderWidth: currentSize === f.key ? 1.5 : 0, borderColor: theme.colors.accent.primary, alignItems: 'center' }}>
                <Text variant="caption" weight={currentSize === f.key ? 'semibold' : 'regular'} color={currentSize === f.key ? theme.colors.accent.primary : theme.colors.text.secondary}>{f.label}</Text>
              </Pressable>
            ))}
          </View>

          {/* Font Family */}
          <Text variant="caption" weight="semibold" color={theme.colors.text.secondary} style={{ marginBottom: 8 }}>Шрифт</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {FONT_FAMILIES.map(f => (
              <Pressable key={f.key} onPress={() => setFontFamily(f.key)} style={{ flex: 1, paddingVertical: 10, borderRadius: 12, backgroundColor: currentFont === f.key ? theme.colors.accent.primary + '20' : theme.colors.background.elevated, borderWidth: currentFont === f.key ? 1.5 : 0, borderColor: theme.colors.accent.primary, alignItems: 'center' }}>
                <Text variant="caption" weight={currentFont === f.key ? 'semibold' : 'regular'} color={currentFont === f.key ? theme.colors.accent.primary : theme.colors.text.secondary}>{f.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </View>
  );
}
