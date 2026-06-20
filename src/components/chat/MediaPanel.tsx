import React, { memo, useCallback, useEffect, useState } from 'react';
import { View, Pressable, ScrollView, Text as RNText, StyleSheet, Dimensions } from 'react-native';
import { BlurView } from 'expo-blur';
import { Feather } from '@expo/vector-icons';
import Reanimated, { useSharedValue, useAnimatedStyle, withTiming, Easing, runOnJS } from 'react-native-reanimated';
import { useLiquidGlassActive, GlassBg, NativeGlassView } from '../ui/LiquidGlass';
import { CachedImage } from '../ui/CachedImage';
import { EmojiPanel } from './EmojiPanel';
import { GifPanel } from './GifPanel';
import { GiphyItem } from '../../services/giphy';

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
  /** Send a GIF (gif grid) — receives the full item to record in recents. */
  onSelectGif: (item: GiphyItem) => void;
  /** Delete the last character from the composer (backspace circle). */
  onBackspace: () => void;
  /** Most-recently-used emoji, shown as a quick-pick row at the top. */
  recentEmoji: string[];
  /** Most-recently-used GIFs, prepended to the GIF grid. */
  recentGifs: GiphyItem[];
  theme: any;
  bottomInset?: number;
  /** Localized labels so we don't pull the i18n hook here. */
  labels: { gif: string; emoji: string; copy: string; send: string };
  /** Long-press popup → send a single emoji as its own chat message. */
  onSendEmoji?: (e: string) => void;
  /** Long-press popup → copy an emoji to the clipboard. */
  onCopyEmoji?: (e: string) => void;
  /** Long-press popup → send a GIF to the chat (same path as a tap). */
  onSendGif?: (item: GiphyItem) => void;
  /** Long-press popup → copy a GIF (its URL) to the clipboard. */
  onCopyGif?: (item: GiphyItem) => void;
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
  onBackspace,
  recentEmoji,
  recentGifs,
  theme,
  bottomInset = 0,
  labels,
  onSendEmoji,
  onCopyEmoji,
  onSendGif,
  onCopyGif,
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

  // ── Long-press preview popup (additive overlay) ───────────────────────────
  // A SEPARATE absolute overlay above the panel — it never touches the slide
  // track, the bottom switcher, or the lift. Long-pressing any emoji/GIF cell
  // opens it with the item ENLARGED and Copy/Send buttons beneath. A normal
  // tap is unchanged (insert emoji / send GIF). Dim backdrop, tap-outside to
  // dismiss, native-driver scale+opacity in.
  type Preview =
    | { kind: 'emoji'; emoji: string }
    | { kind: 'gif'; item: GiphyItem };
  const [preview, setPreview] = useState<Preview | null>(null);
  const previewSV = useSharedValue(0);

  const openPreview = useCallback((p: Preview) => {
    setPreview(p);
    previewSV.value = withTiming(1, { duration: 160, easing: Easing.out(Easing.cubic) });
  }, [previewSV]);

  // Animated dismiss for the backdrop tap (panel stays open).
  const closePreview = useCallback(() => {
    previewSV.value = withTiming(0, { duration: 130 }, (finished) => {
      if (finished) runOnJS(setPreview)(null);
    });
  }, [previewSV]);

  // Immediate teardown — used by the action buttons, since "Send GIF" closes
  // the whole panel (this component unmounts) and we don't want an animation
  // callback firing into an unmounted tree.
  const tearDownPreview = useCallback(() => {
    previewSV.value = 0;
    setPreview(null);
  }, [previewSV]);

  const onLongPressEmoji = useCallback((e: string) => openPreview({ kind: 'emoji', emoji: e }), [openPreview]);
  const onLongPressGif = useCallback((item: GiphyItem) => openPreview({ kind: 'gif', item }), [openPreview]);

  const previewCardStyle = useAnimatedStyle(() => ({
    opacity: previewSV.value,
    transform: [{ scale: 0.86 + previewSV.value * 0.14 }],
  }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: previewSV.value }));

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
              <Pressable
                key={e + i}
                onPress={() => onSelectEmoji(e)}
                onLongPress={onSendEmoji || onCopyEmoji ? () => onLongPressEmoji(e) : undefined}
                delayLongPress={280}
                hitSlop={4}
                style={styles.recentCell}
              >
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
            <EmojiPanel bare height={height} onSelect={onSelectEmoji} onLongPress={onSendEmoji || onCopyEmoji ? onLongPressEmoji : undefined} theme={theme} bottomInset={56 + bottomInset} />
          </View>
          <View style={styles.page}>
            <GifPanel bare height={height} onSelect={onSelectGif} onLongPress={onSendGif || onCopyGif ? onLongPressGif : undefined} recentGifs={recentGifs} theme={theme} bottomInset={56 + bottomInset} />
          </View>
        </Reanimated.View>
      </View>

      {/* Bottom row: segmented GIF/Эмодзи switcher (glass on iOS-26, blur
          elsewhere) + a round backspace button so picks can be undone. */}
      <View style={[styles.switchWrap, { paddingBottom: 8 + bottomInset }]} pointerEvents="box-none">
        {glassActive ? (
          <NativeGlassView glassStyle="regular" isInteractive colorScheme={theme.isDark ? 'dark' : 'light'} style={styles.pill}>
            {renderSwitch('gif', labels.gif)}
            {renderSwitch('emoji', labels.emoji)}
          </NativeGlassView>
        ) : (
          <View style={[styles.pill, styles.pillFlat]}>
            <BlurView intensity={28} tint={theme.isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
            {renderSwitch('gif', labels.gif)}
            {renderSwitch('emoji', labels.emoji)}
          </View>
        )}

        {glassActive ? (
          <Pressable onPress={onBackspace} hitSlop={6} style={styles.backspace}>
            <NativeGlassView glassStyle="regular" isInteractive colorScheme={theme.isDark ? 'dark' : 'light'} style={styles.backspaceFill}>
              <Feather name="delete" size={18} color={theme.colors.text.secondary} />
            </NativeGlassView>
          </Pressable>
        ) : (
          <Pressable onPress={onBackspace} hitSlop={6} style={[styles.backspace, styles.backspaceFlat]}>
            <BlurView intensity={28} tint={theme.isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
            <Feather name="delete" size={18} color={theme.colors.text.secondary} />
          </Pressable>
        )}
      </View>

      {/* Long-press preview popup — additive absolute overlay. Sits ABOVE the
          slide track and switcher; never affects their layout/animation. */}
      {preview ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          <Reanimated.View style={[StyleSheet.absoluteFill, styles.previewBackdrop, backdropStyle]}>
            <Pressable style={StyleSheet.absoluteFill} onPress={closePreview} />
          </Reanimated.View>

          <View style={styles.previewCenter} pointerEvents="box-none">
            <Reanimated.View style={[styles.previewCard, previewCardStyle, { backgroundColor: theme.colors.background.elevated }]}>
              {preview.kind === 'emoji' ? (
                <RNText style={styles.previewEmoji} allowFontScaling={false}>{preview.emoji}</RNText>
              ) : (
                <CachedImage uri={preview.item.previewUrl} style={styles.previewGif} resizeMode="contain" />
              )}

              <View style={styles.previewActions}>
                <Pressable
                  style={[styles.previewBtn, { backgroundColor: theme.colors.background.secondary }]}
                  onPress={() => {
                    if (preview.kind === 'emoji') onCopyEmoji?.(preview.emoji);
                    else onCopyGif?.(preview.item);
                    tearDownPreview();
                  }}
                >
                  <Feather name="copy" size={15} color={theme.colors.text.secondary} />
                  <RNText style={[styles.previewBtnText, { color: theme.colors.text.primary }]}>{labels.copy}</RNText>
                </Pressable>

                <Pressable
                  style={[styles.previewBtn, { backgroundColor: theme.colors.accent.primary }]}
                  onPress={() => {
                    if (preview.kind === 'emoji') onSendEmoji?.(preview.emoji);
                    else onSendGif?.(preview.item);
                    tearDownPreview();
                  }}
                >
                  <Feather name="send" size={15} color="#FFFFFF" />
                  <RNText style={[styles.previewBtnText, { color: '#FFFFFF' }]}>{labels.send}</RNText>
                </Pressable>
              </View>
            </Reanimated.View>
          </View>
        </View>
      ) : null}
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
  switchWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  pill: { flexDirection: 'row', borderRadius: 22, padding: 3, gap: 2, overflow: 'hidden' },
  pillFlat: { backgroundColor: 'rgba(127,127,127,0.16)' },
  segment: { paddingHorizontal: 20, paddingVertical: 8, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  backspace: { width: 40, height: 40, borderRadius: 20, marginLeft: 10, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  backspaceFill: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  backspaceFlat: { backgroundColor: 'rgba(127,127,127,0.16)' },
  // Long-press preview popup.
  previewBackdrop: { backgroundColor: 'rgba(0,0,0,0.5)' },
  previewCenter: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  previewCard: { borderRadius: 22, paddingHorizontal: 18, paddingTop: 18, paddingBottom: 14, alignItems: 'center', minWidth: 180, shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.25, shadowRadius: 16, elevation: 12 },
  previewEmoji: { fontSize: 96, lineHeight: 110, marginBottom: 8 },
  previewGif: { width: 200, height: 200, borderRadius: 14, marginBottom: 10, backgroundColor: 'rgba(127,127,127,0.12)' },
  previewActions: { flexDirection: 'row', gap: 10, marginTop: 2 },
  previewBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 14 },
  previewBtnText: { fontSize: 14, fontWeight: '700' },
});

export const MediaPanel = memo(MediaPanelComponent);
