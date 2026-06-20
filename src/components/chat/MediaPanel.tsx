import React, { memo, useCallback, useEffect } from 'react';
import { View, Pressable, ScrollView, Text as RNText, StyleSheet, Dimensions } from 'react-native';
import Reanimated, { useSharedValue, useAnimatedStyle, withTiming, Easing } from 'react-native-reanimated';
import { useLiquidGlassActive, GlassBg } from '../ui/LiquidGlass';
import { EmojiPanel } from './EmojiPanel';
import { GifPanel } from './GifPanel';

const PANEL_W = Dimensions.get('window').width;

export type MediaTab = 'emoji' | 'gif';

export interface MediaPanelProps {
  /** Panel height (≈ last real keyboard height) supplied by the parent. */
  height: number;
  /** Active tab. */
  tab: MediaTab;
  /** Switch tab (bottom segmented control). */
  onTabChange: (tab: MediaTab) => void;
  /** Insert an emoji (recent row + emoji grid). */
  onSelectEmoji: (e: string) => void;
  /** Send a GIF (gif grid). */
  onSelectGif: (url: string) => void;
  /** Most-recently-used emoji, shown as a quick-pick row at the top. */
  recentEmoji: string[];
  theme: any;
  bottomInset?: number;
  /** Localized labels so we don't pull the i18n hook here. */
  labels: { gif: string; emoji: string };
}

// ── Unified chat media panel ───────────────────────────────────────────────
//
// One docked surface that hosts BOTH the emoji grid and the GIF grid on a
// horizontal track, plus a Telegram-style bottom segmented switcher (GIF /
// Эмодзи) and a shared "recently used emoji" quick-row at the top. Switching
// tabs slides the track left/right on the UI thread (native translateX) — both
// children stay mounted so the slide carries real content with zero pop-in.
function MediaPanelComponent({
  height,
  tab,
  onTabChange,
  onSelectEmoji,
  onSelectGif,
  recentEmoji,
  theme,
  bottomInset = 0,
  labels,
}: MediaPanelProps) {
  const glassActive = useLiquidGlassActive();

  // Horizontal slide. 0 → emoji, 1 → gif. Native-driver translateX.
  const tabSV = useSharedValue(tab === 'gif' ? 1 : 0);
  useEffect(() => {
    tabSV.value = withTiming(tab === 'gif' ? 1 : 0, {
      duration: 260,
      easing: Easing.out(Easing.cubic),
    });
  }, [tab, tabSV]);
  const trackStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -tabSV.value * PANEL_W }],
  }));

  const hasRecents = recentEmoji.length > 0;

  const renderSwitch = useCallback(
    (key: MediaTab, label: string) => {
      const active = tab === key;
      return (
        <Pressable
          key={key}
          onPress={() => { if (!active) onTabChange(key); }}
          style={[
            styles.segment,
            active && { backgroundColor: theme.colors.accent.primary },
          ]}
        >
          <RNText
            style={{
              fontSize: 13,
              fontWeight: '700',
              color: active ? '#FFFFFF' : theme.colors.text.secondary,
            }}
          >
            {label}
          </RNText>
        </Pressable>
      );
    },
    [tab, onTabChange, theme],
  );

  return (
    <View
      style={[
        styles.container,
        { height, backgroundColor: glassActive ? 'transparent' : theme.colors.background.elevated },
      ]}
    >
      {glassActive ? (
        <GlassBg
          borderRadius={28}
          glassStyle="regular"
          interactive={false}
          colorScheme={theme.isDark ? 'dark' : 'light'}
          tintColor={theme.isDark ? 'rgba(26,26,31,0.55)' : 'rgba(255,255,255,0.55)'}
        />
      ) : null}

      {/* Recently-used emoji quick row — shared across both tabs. */}
      {hasRecents ? (
        <View style={[styles.recentRow, { borderBottomColor: theme.colors.border.light }]}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="always"
            contentContainerStyle={styles.recentContent}
          >
            {recentEmoji.map((e, i) => (
              <Pressable key={e + i} onPress={() => onSelectEmoji(e)} hitSlop={4} style={styles.recentCell}>
                <RNText style={styles.recentEmoji} allowFontScaling={false}>{e}</RNText>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {/* Sliding track — both grids mounted side by side. */}
      <View style={styles.trackWrap}>
        <Reanimated.View style={[styles.track, trackStyle]}>
          <View style={styles.page}>
            <EmojiPanel bare height={height} onSelect={onSelectEmoji} theme={theme} bottomInset={56 + bottomInset} />
          </View>
          <View style={styles.page}>
            <GifPanel bare height={height} onSelect={onSelectGif} theme={theme} bottomInset={56 + bottomInset} />
          </View>
        </Reanimated.View>
      </View>

      {/* Bottom segmented switcher (GIF / Эмодзи), centered like Telegram. */}
      <View style={[styles.switchWrap, { paddingBottom: 8 + bottomInset }]} pointerEvents="box-none">
        <View
          style={[
            styles.switchPill,
            {
              backgroundColor: glassActive
                ? (theme.isDark ? 'rgba(0,0,0,0.28)' : 'rgba(255,255,255,0.45)')
                : theme.colors.background.secondary,
            },
          ]}
        >
          {renderSwitch('gif', labels.gif)}
          {renderSwitch('emoji', labels.emoji)}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    overflow: 'hidden',
  },
  recentRow: { height: 46, borderBottomWidth: 0.5, justifyContent: 'center' },
  recentContent: { paddingHorizontal: 10, alignItems: 'center', gap: 2 },
  recentCell: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  recentEmoji: { fontSize: 26 },
  trackWrap: { flex: 1, overflow: 'hidden' },
  track: { flex: 1, flexDirection: 'row', width: PANEL_W * 2 },
  page: { width: PANEL_W },
  // The switcher floats over the bottom of the grids (the grids already pad
  // their content by 56 + inset so nothing hides under it).
  switchWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center' },
  switchPill: { flexDirection: 'row', borderRadius: 22, padding: 3, gap: 2 },
  segment: { paddingHorizontal: 20, paddingVertical: 8, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
});

export const MediaPanel = memo(MediaPanelComponent);
