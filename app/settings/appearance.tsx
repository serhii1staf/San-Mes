/**
 * Settings → Внешний вид.
 *
 * Everything here applies the moment it is tapped and the preview at the top (the app in miniature,
 * AppPreview) shows the result. There is no Save button — a carousel you had to save (and that
 * discarded the choice on Back) was the old design.
 *
 * The theme thumbnails are tiny chats drawn in each theme's own colours. They are plain Views with
 * no text and no icons, so a row of thirty costs almost nothing to mount — the old cards drew a fake
 * feed post (with like/repost icons for features that no longer exist) and a five-tab bar with the
 * removed Create button.
 *
 * ── ONLY THE LOOK OF THE WHOLE APP LIVES HERE ─────────────────────────────────
 *
 * This screen used to repeat four rows of «Настройки чатов» (chat background, message colour, bubble
 * rounding, text size) in a «Чаты» section. Reported as illogical, and it was: the same values had two
 * homes, and the chat-settings screen had more of them (the chat font, link emoji, the scroll button,
 * reset). Now the split is by scope. Here: the theme (dark or light), the colour theme and the
 * interface fonts, all of which change every screen. Everything about how a chat looks stays in
 * Settings → Настройки чатов, one row above this screen in the settings list.
 */
import React, { useCallback, useMemo, useRef } from 'react';
import { View, Pressable, ScrollView, FlatList, StyleSheet, Alert, type ListRenderItem } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { AppPreview } from '../../src/components/settings/AppPreview';
import { useThemeStore, ACCENT_COLORS, type ThemeMode } from '../../src/store/themeStore';
import { headerScrimHeights, SCRIM_LOCATIONS, topScrimColors } from '../../src/theme/scrim';
import { triggerHaptic } from '../../src/utils/haptics';
import { useT } from '../../src/i18n/store';
import { useScreenMountMark } from '../../src/hooks/useScreenMountMark';

type ThemeConfig = (typeof ACCENT_COLORS)[number];

const THUMB_W = 84;
const THUMB_H = 112;

/** A chat in miniature, in one theme's colours: two incoming lines and one outgoing bubble. */
const ThemeThumb = React.memo(function ThemeThumb({
  config,
  isDark,
  selected,
  label,
  onPress,
  onLongPress,
}: {
  config: ThemeConfig;
  isDark: boolean;
  selected: boolean;
  label: string;
  onPress: (key: string) => void;
  onLongPress?: (key: string) => void;
}) {
  const bg = isDark ? config.darkBg : config.light;
  const incoming = isDark ? config.darkElevated : '#FFFFFF';
  const ring = selected ? config.color : 'transparent';
  return (
    <Pressable
      onPress={() => onPress(config.key)}
      onLongPress={onLongPress ? () => onLongPress(config.key) : undefined}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      style={styles.thumbWrap}
    >
      <View style={[styles.thumbRing, { borderColor: ring }]}>
        <View style={[styles.thumb, { backgroundColor: bg }]}>
          <View style={[styles.line, { width: 46, backgroundColor: incoming }]} />
          <View style={[styles.line, { width: 32, backgroundColor: incoming, marginTop: 5 }]} />
          <View style={[styles.line, styles.lineOut, { width: 40, backgroundColor: config.color }]} />
          <View style={[styles.line, styles.lineOut, { width: 26, backgroundColor: config.color, marginTop: 5 }]} />
          {selected ? (
            <View style={[styles.check, { backgroundColor: config.color }]}>
              <Feather name="check" size={11} color="#FFFFFF" />
            </View>
          ) : null}
        </View>
      </View>
      <Text variant="caption" weight={selected ? 'semibold' : 'regular'} numberOfLines={1} align="center" style={styles.thumbLabel}>
        {label}
      </Text>
    </Pressable>
  );
});

function ModeSwitch({ mode, onChange }: { mode: ThemeMode; onChange: (m: ThemeMode) => void }) {
  const theme = useTheme();
  const t = useT();
  const options: { key: ThemeMode; icon: React.ComponentProps<typeof Feather>['name']; label: string }[] = [
    { key: 'dark', icon: 'moon', label: t('appearance.mode_dark') },
    { key: 'light', icon: 'sun', label: t('appearance.mode_light') },
  ];
  return (
    <View style={[styles.segment, { backgroundColor: theme.colors.background.elevated }]}>
      {options.map((o) => {
        const active = o.key === mode;
        return (
          <Pressable
            key={o.key}
            onPress={() => onChange(o.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={[styles.segmentItem, active ? { backgroundColor: theme.colors.accent.primary + '26' } : null]}
          >
            <Feather name={o.icon} size={16} color={active ? theme.colors.accent.primary : theme.colors.text.secondary} />
            <Text variant="body" weight={active ? 'semibold' : 'regular'} color={active ? theme.colors.accent.primary : theme.colors.text.secondary}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function AppearanceScreen() {
  useScreenMountMark('settings/appearance');
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();

  const mode = useThemeStore((s) => s.mode);
  const accent = useThemeStore((s) => s.accent);
  const aiThemes = useThemeStore((s) => s.aiThemes);
  const setMode = useThemeStore((s) => s.setMode);
  const setAccent = useThemeStore((s) => s.setAccent);
  const isDark = mode === 'dark';

  const themes = useMemo(() => [...ACCENT_COLORS, ...aiThemes], [aiThemes]);
  const initialIndex = Math.max(0, themes.findIndex((c) => c.key === accent));
  const listRef = useRef<FlatList<ThemeConfig>>(null);

  const pickTheme = useCallback(
    (key: string) => {
      triggerHaptic('selection');
      setAccent(key);
    },
    [setAccent],
  );
  const deleteAiTheme = useCallback(
    (key: string) => {
      if (!key.startsWith('ai-')) return;
      Alert.alert(t('appearance.delete_theme'), undefined, [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () => {
            useThemeStore.setState((s) => ({ aiThemes: s.aiThemes.filter((c) => c.key !== key) }));
            if (useThemeStore.getState().accent === key) setAccent('sage');
          },
        },
      ]);
    },
    [setAccent, t],
  );
  const changeMode = useCallback(
    (m: ThemeMode) => {
      if (m === mode) return;
      triggerHaptic('selection');
      setMode(m);
    },
    [mode, setMode],
  );

  const renderThumb = useCallback<ListRenderItem<ThemeConfig>>(
    ({ item }) => (
      <ThemeThumb
        config={item}
        isDark={isDark}
        selected={item.key === accent}
        label={item.key.startsWith('ai-') ? item.label : t(`theme.color.${item.key}`, item.label)}
        onPress={pickTheme}
        onLongPress={item.key.startsWith('ai-') ? deleteAiTheme : undefined}
      />
    ),
    // `t` changes identity every render; the labels follow the locale through the screen re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isDark, accent, pickTheme, deleteAiTheme],
  );
  const getItemLayout = useCallback(
    (_: unknown, index: number) => ({ length: THUMB_W + 12, offset: (THUMB_W + 12) * index, index }),
    [],
  );

  const { content: headerContentHeight, gradient: headerGradientHeight } = headerScrimHeights(insets.top);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>
      <View style={[styles.header, { height: headerGradientHeight }]} pointerEvents="box-none">
        <LinearGradient
          colors={topScrimColors(theme.isDark, theme.colors.background.primary)}
          locations={SCRIM_LOCATIONS}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <View style={[styles.headerRow, { paddingTop: insets.top + 8 }]}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back} accessibilityRole="button" accessibilityLabel={t('common.back')}>
            <Feather name="chevron-left" size={26} color={theme.colors.text.primary} />
          </Pressable>
          <Text variant="subheading" weight="bold" numberOfLines={1}>{t('appearance.title')}</Text>
          <View style={styles.back} />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingTop: headerContentHeight + 8, paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Live preview of the app itself: the theme, the mode and the interface font change every
            screen, not one chat. The chat look has its own previews in the chat settings modals. */}
        <View style={[styles.preview, { borderColor: theme.colors.border.light }]}>
          <AppPreview height={330} />
        </View>

        <View style={{ paddingHorizontal: 16 }}>
          <ModeSwitch mode={mode} onChange={changeMode} />
        </View>

        <Text variant="caption" weight="semibold" color={theme.colors.text.tertiary} style={styles.groupTitle}>
          {t('appearance.theme').toUpperCase()}
        </Text>
        <FlatList
          ref={listRef}
          data={themes}
          horizontal
          keyExtractor={(c) => c.key}
          renderItem={renderThumb}
          getItemLayout={getItemLayout}
          initialScrollIndex={initialIndex > 2 ? initialIndex - 1 : 0}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 12 }}
          initialNumToRender={6}
          windowSize={5}
        />
        <Text variant="caption" color={theme.colors.text.tertiary} style={styles.groupFooter}>
          {t('appearance.theme_hint')}
        </Text>

        {/* No «Чаты» section: the chat look is in Settings → Настройки чатов (see the note at the top).
            And no «Интерфейс» → «Шрифты» row any more: it was the same screen as the «Шрифты» row
            directly under «Оформление» in Settings, so the two read as a duplicate. */}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 100 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 8 },
  back: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  preview: {
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  segment: { flexDirection: 'row', borderRadius: 18, padding: 4, gap: 4 },
  segmentItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    borderRadius: 14,
  },
  groupTitle: { marginTop: 22, marginBottom: 10, paddingHorizontal: 32, letterSpacing: 0.4, fontSize: 12 },
  groupFooter: { marginTop: 4, paddingHorizontal: 32, lineHeight: 17 },
  thumbWrap: { width: THUMB_W + 12, alignItems: 'center' },
  thumbRing: { borderRadius: 22, borderWidth: 2.5, padding: 2 },
  thumb: {
    width: THUMB_W,
    height: THUMB_H,
    borderRadius: 18,
    padding: 10,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  line: { height: 13, borderRadius: 7 },
  lineOut: { alignSelf: 'flex-end', marginTop: 10 },
  check: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbLabel: { marginTop: 6, fontSize: 12, maxWidth: THUMB_W + 8 },
});
