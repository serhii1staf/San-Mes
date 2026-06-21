/**
 * "Цвет сообщений" — modal message-color picker.
 *
 * Presented as a slide-up modal (registered in app/_layout). A live
 * ChatPreviewBubbles surface up top recolors the outgoing bubble as you pick;
 * below: a "Тема" chip, trendy gradient combinations (with emoji), solid
 * swatches, and an opacity slider. Drives the app-wide `chatBubble` style on
 * settingsStore (null = follow theme accent).
 */

import React, { useState } from 'react';
import { View, Pressable, StyleSheet, Text as RNText, ScrollView, Dimensions, LayoutChangeEvent } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { useSharedValue, useAnimatedStyle, runOnJS } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useTheme } from '../../src/theme';
import { ChatPreviewBubbles } from '../../src/components/ui/ChatPreviewBubbles';
import { useChatSettingsStore, GLOBAL_CHAT_SETTINGS_KEY } from '../../src/store/chatSettingsStore';
import { useSettingsStore } from '../../src/store/settingsStore';
import { BUBBLE_COLORS, GRADIENT_PRESETS, MIN_OPACITY, readableTextOn, type BubbleStyle } from '../../src/constants/bubbleColors';
import { triggerHaptic } from '../../src/utils/haptics';
import { useT } from '../../src/i18n/store';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const PREVIEW_HEIGHT = Math.round(SCREEN_HEIGHT * 0.42);
const SWATCH = 46;

function sameColors(a: string[], b: string[]) {
  return a.length === b.length && a.every((c, i) => c === b[i]);
}

export default function ChatBubbleColorScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();

  const current = useSettingsStore((s) => s.chatBubble);
  const setChatBubble = useSettingsStore((s) => s.setChatBubble);
  const getSettings = useChatSettingsStore((s) => s.getSettings);
  const applied = getSettings(GLOBAL_CHAT_SETTINGS_KEY);

  // Pending state: null = follow theme. colors[] + opacity otherwise.
  const [pendingColors, setPendingColors] = useState<string[] | null>(current?.colors ?? null);
  const [opacity, setOpacity] = useState<number>(current?.opacity ?? 1);

  const accent = theme.colors.accent.primary;
  const previewColors = pendingColors && pendingColors.length > 0 ? pendingColors : [accent];
  const previewText = pendingColors && pendingColors.length > 0 ? readableTextOn(pendingColors) : '#FFFFFF';

  const onCancel = () => { triggerHaptic('selection'); router.back(); };
  const onApply = () => {
    triggerHaptic('medium');
    const style: BubbleStyle | null = pendingColors && pendingColors.length > 0
      ? { colors: pendingColors, opacity }
      : null;
    setChatBubble(style);
    router.back();
  };
  const pick = (colors: string[] | null) => {
    triggerHaptic('selection');
    setPendingColors(colors);
  };

  const isThemeSel = pendingColors === null;
  const bgPrimary = theme.colors.background.primary;
  const bgElevated = theme.colors.background.elevated;
  const textPrimary = theme.colors.text.primary;
  const textTertiary = theme.colors.text.tertiary;
  const borderLight = theme.colors.border.light;

  return (
    <View style={[styles.root, { backgroundColor: bgPrimary }]}>
      <ChatPreviewBubbles
        height={PREVIEW_HEIGHT}
        fontSize={applied.fontSize}
        fontFamily={applied.fontFamily === 'mono' ? 'monospace' : applied.fontFamily === 'serif' ? 'serif' : undefined}
        bubbleRadius={applied.bubbleRadius}
        backgroundImage={applied.backgroundImage}
        topPadding={insets.top + 16}
        bubbleColors={previewColors}
        bubbleOpacity={opacity}
        bubbleTextColor={previewText}
      />

      {/* Grabber + title */}
      <View style={styles.titleRow}>
        <RNText style={[styles.title, { color: textPrimary }]} allowFontScaling={false}>
          {t('chat_settings.message_color', 'Цвет сообщений')}
        </RNText>
      </View>

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 12 }}>
        {/* ── Opacity ─────────────────────────────────────────────── */}
        <View style={styles.sectionHead}>
          <RNText style={[styles.sectionTitle, { color: textTertiary }]} allowFontScaling={false}>
            {t('chat_settings.opacity', 'Прозрачность')}
          </RNText>
          <RNText style={[styles.sectionValue, { color: textPrimary }]} allowFontScaling={false}>
            {Math.round(opacity * 100)}%
          </RNText>
        </View>
        <View style={[styles.sliderCard, { backgroundColor: bgElevated, borderColor: borderLight }]}>
          <OpacitySlider
            value={opacity}
            onChange={setOpacity}
            color={previewColors[0]}
            trackColor={borderLight}
          />
        </View>

        {/* ── Gradient combinations ───────────────────────────────── */}
        <RNText style={[styles.sectionTitle, { color: textTertiary, marginTop: 18, marginBottom: 10 }]} allowFontScaling={false}>
          {t('chat_settings.gradients', 'Комбинации')}
        </RNText>
        <View style={styles.grid}>
          {/* Theme chip lives first so it's easy to revert. */}
          <Pressable onPress={() => pick(null)} style={styles.cellWrap}>
            <View style={[styles.cell, { borderWidth: isThemeSel ? 3 : 0, borderColor: textPrimary }]}>
              <LinearGradient colors={[accent, accent]} style={StyleSheet.absoluteFill} />
              <Feather name="droplet" size={18} color="#FFFFFF" />
            </View>
            <RNText style={[styles.cellLabel, { color: textTertiary }]} numberOfLines={1} allowFontScaling={false}>
              {t('chat_settings.bubble_color.theme', 'Тема')}
            </RNText>
          </Pressable>

          {GRADIENT_PRESETS.map((g) => {
            const sel = !!pendingColors && sameColors(pendingColors, g.colors);
            return (
              <Pressable key={g.key} onPress={() => pick([...g.colors])} style={styles.cellWrap}>
                <View style={[styles.cell, { borderWidth: sel ? 3 : 0, borderColor: textPrimary }]}>
                  <LinearGradient colors={g.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
                  <RNText style={styles.cellEmoji} allowFontScaling={false}>{sel ? '' : g.emoji}</RNText>
                  {sel ? <Feather name="check" size={20} color="#FFFFFF" /> : null}
                </View>
                <RNText style={[styles.cellLabel, { color: textTertiary }]} numberOfLines={1} allowFontScaling={false}>
                  {g.label}
                </RNText>
              </Pressable>
            );
          })}
        </View>

        {/* ── Solid colors ────────────────────────────────────────── */}
        <RNText style={[styles.sectionTitle, { color: textTertiary, marginTop: 18, marginBottom: 10 }]} allowFontScaling={false}>
          {t('chat_settings.solid_colors', 'Однотонные')}
        </RNText>
        <View style={styles.grid}>
          {BUBBLE_COLORS.map((sw) => {
            const sel = !!pendingColors && pendingColors.length === 1 && pendingColors[0] === sw.color;
            return (
              <Pressable key={sw.key} onPress={() => pick([sw.color])} style={styles.cellWrap}>
                <View style={[styles.cell, { backgroundColor: sw.color, borderWidth: sel ? 3 : 0, borderColor: textPrimary }]}>
                  {sel ? <Feather name="check" size={20} color={readableTextOn(sw.color)} /> : null}
                </View>
                <RNText style={[styles.cellLabel, { color: textTertiary }]} numberOfLines={1} allowFontScaling={false}>
                  {sw.label}
                </RNText>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      {/* Footer */}
      <View style={[styles.footerRow, { paddingBottom: insets.bottom + 12, paddingHorizontal: 16, backgroundColor: bgPrimary, borderTopColor: borderLight }]}>
        <Pressable onPress={onCancel} style={[styles.footerBtn, { backgroundColor: bgElevated, borderColor: borderLight }]}>
          <RNText allowFontScaling={false} style={[styles.footerBtnText, { color: textPrimary }]}>{t('common.cancel')}</RNText>
        </Pressable>
        <Pressable onPress={onApply} style={[styles.footerBtn, { backgroundColor: previewColors[0], borderColor: previewColors[0] }]}>
          <RNText allowFontScaling={false} style={[styles.footerBtnText, { color: previewText }]}>{t('common.apply')}</RNText>
        </Pressable>
      </View>
    </View>
  );
}

// Continuous opacity slider (MIN_OPACITY..1). Pan on the UI thread; commits the
// value to JS on each frame via runOnJS (cheap — one number).
function OpacitySlider({ value, onChange, color, trackColor }: { value: number; onChange: (v: number) => void; color: string; trackColor: string }) {
  const width = useSharedValue(0);
  const knobX = useSharedValue(0);

  const toX = (v: number, w: number) => ((v - MIN_OPACITY) / (1 - MIN_OPACITY)) * w;
  const toVal = (x: number, w: number) => MIN_OPACITY + (Math.max(0, Math.min(x, w)) / w) * (1 - MIN_OPACITY);

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    width.value = w;
    knobX.value = toX(value, w);
  };

  const commit = (x: number) => {
    const w = width.value;
    if (w <= 0) return;
    onChange(Math.round(toVal(x, w) * 100) / 100);
  };

  const pan = Gesture.Pan()
    .minDistance(0)
    .onBegin((e) => { 'worklet'; knobX.value = Math.max(0, Math.min(e.x, width.value)); runOnJS(commit)(e.x); })
    .onUpdate((e) => { 'worklet'; knobX.value = Math.max(0, Math.min(e.x, width.value)); runOnJS(commit)(e.x); });

  const filled = useAnimatedStyle(() => ({ width: knobX.value }));
  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: knobX.value - 11 }] }));

  return (
    <GestureDetector gesture={pan}>
      <View style={sliderStyles.container} onLayout={onLayout} collapsable={false}>
        <View style={[sliderStyles.track, { backgroundColor: trackColor }]} pointerEvents="none" />
        <Animated.View style={[sliderStyles.track, { left: 0, backgroundColor: color }, filled]} pointerEvents="none" />
        <Animated.View style={[sliderStyles.thumb, { borderColor: color }, thumb]} pointerEvents="none" />
      </View>
    </GestureDetector>
  );
}

const sliderStyles = StyleSheet.create({
  container: { flex: 1, height: 36, justifyContent: 'center' },
  track: { position: 'absolute', left: 0, right: 0, height: 4, borderRadius: 2 },
  thumb: {
    position: 'absolute', width: 22, height: 22, borderRadius: 11, backgroundColor: '#FFFFFF', borderWidth: 2,
    top: 7, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 3,
  },
});

const styles = StyleSheet.create({
  root: { flex: 1 },
  titleRow: { alignItems: 'center', paddingTop: 10, paddingBottom: 6 },
  title: { fontSize: 16, fontWeight: '700' },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, marginBottom: 8 },
  sectionTitle: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  sectionValue: { fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  sliderCard: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 14, borderWidth: 0.5 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 14 },
  cellWrap: { width: '20%', alignItems: 'center', gap: 5 },
  cell: {
    width: SWATCH, height: SWATCH, borderRadius: SWATCH / 2, overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  cellEmoji: { fontSize: 20 },
  cellLabel: { fontSize: 10, fontWeight: '500' },
  footerRow: { flexDirection: 'row', gap: 10, paddingTop: 10, borderTopWidth: 0.5 },
  footerBtn: { flex: 1, paddingVertical: 14, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 0.5 },
  footerBtnText: { fontSize: 15, fontWeight: '600' },
});
