/**
 * "Цвет сообщений" — modal message-color picker.
 *
 * Slide-up modal (registered in app/_layout). A live ChatPreviewBubbles surface
 * recolors the outgoing bubble as you pick. Floating X / Apply header pills
 * mirror the other chat modals (text-size, bubble-radius). Below: a custom
 * color/gradient creator (hue spectrum sliders), trendy gradient combinations,
 * solid swatches, and an opacity slider. Drives the app-wide `chatBubble` style
 * on settingsStore (null = follow theme accent).
 */

import React, { useState } from 'react';
import { View, Pressable, StyleSheet, Text as RNText, ScrollView, Dimensions, LayoutChangeEvent } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { useSharedValue, useAnimatedStyle, runOnJS } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useTheme } from '../../src/theme';
import { ShrinkingModalTitle } from '../../src/components/ui';
import { useLiquidGlassActive, NativeGlassView, GlassBg } from '../../src/components/ui/LiquidGlass';
import { ChatPreviewBubbles } from '../../src/components/ui/ChatPreviewBubbles';
import { useChatSettingsStore, GLOBAL_CHAT_SETTINGS_KEY } from '../../src/store/chatSettingsStore';
import { useSettingsStore } from '../../src/store/settingsStore';
import {
  BUBBLE_COLORS, GRADIENT_PRESETS, MIN_OPACITY, readableTextOn, hslToHex, hexToHue, type BubbleStyle,
} from '../../src/constants/bubbleColors';
import { triggerHaptic } from '../../src/utils/haptics';
import { useT } from '../../src/i18n/store';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const PREVIEW_HEIGHT = Math.round(SCREEN_HEIGHT * 0.36);
const SWATCH = 46;
const RAINBOW = ['#FF0000', '#FFFF00', '#00FF00', '#00FFFF', '#0000FF', '#FF00FF', '#FF0000'];

function sameColors(a: string[], b: string[]) {
  return a.length === b.length && a.every((c, i) => c === b[i]);
}

export default function ChatBubbleColorScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  const glassActive = useLiquidGlassActive();

  const current = useSettingsStore((s) => s.chatBubble);
  const setChatBubble = useSettingsStore((s) => s.setChatBubble);
  const getSettings = useChatSettingsStore((s) => s.getSettings);
  const applied = getSettings(GLOBAL_CHAT_SETTINGS_KEY);

  const [pendingColors, setPendingColors] = useState<string[] | null>(current?.colors ?? null);
  const [opacity, setOpacity] = useState<number>(current?.opacity ?? 1);

  // Custom creator state — seeded from the current selection if any.
  const [customGradient, setCustomGradient] = useState<boolean>((current?.colors?.length ?? 0) > 1);
  const [hue1, setHue1] = useState<number>(current?.colors?.[0] ? hexToHue(current.colors[0]) : 210);
  const [hue2, setHue2] = useState<number>(current?.colors?.[1] ? hexToHue(current.colors[1]) : 320);

  const accent = theme.colors.accent.primary;
  const customColors = customGradient ? [hslToHex(hue1), hslToHex(hue2)] : [hslToHex(hue1)];

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
  const pick = (colors: string[] | null) => { triggerHaptic('selection'); setPendingColors(colors); };
  // Live-apply the custom editor result as the user drags / toggles.
  const applyCustom = (next: string[]) => setPendingColors(next);

  const isThemeSel = pendingColors === null;
  const isCustomSel = !!pendingColors && sameColors(pendingColors, customColors);
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
        topPadding={insets.top + 56}
        bubbleColors={previewColors}
        bubbleOpacity={opacity}
        bubbleTextColor={previewText}
      />

      {/* ── Floating header pills (X / title / Apply) ───────────────── */}
      <View style={[styles.headerRow, { top: insets.top + 10 }]} pointerEvents="box-none">
        <Pressable onPress={onCancel} hitSlop={10} style={glassActive ? [styles.headerPill, { overflow: 'visible' }] : styles.headerPill}>
          {glassActive ? (
            <NativeGlassView glassStyle="regular" isInteractive colorScheme="dark" style={[styles.headerPillInner, { borderRadius: 18 }]}>
              <Feather name="x" size={18} color="#FFFFFF" />
            </NativeGlassView>
          ) : (
            <BlurView intensity={80} tint="dark" style={styles.headerPillInner}>
              <Feather name="x" size={18} color="#FFFFFF" />
            </BlurView>
          )}
        </Pressable>
        <View style={styles.headerTitleAbs} pointerEvents="box-none">
          <ShrinkingModalTitle>
            <View style={styles.headerTitlePill}>
              {glassActive ? (
                <View style={[styles.headerTitleInner, { borderRadius: 18, overflow: 'hidden' }]}>
                  <GlassBg borderRadius={18} colorScheme="dark" />
                  <RNText style={styles.headerTitleText} allowFontScaling={false} numberOfLines={1}>
                    {t('chat_settings.message_color', 'Цвет сообщений')}
                  </RNText>
                </View>
              ) : (
                <BlurView intensity={80} tint="dark" style={styles.headerTitleInner}>
                  <RNText style={styles.headerTitleText} allowFontScaling={false} numberOfLines={1}>
                    {t('chat_settings.message_color', 'Цвет сообщений')}
                  </RNText>
                </BlurView>
              )}
            </View>
          </ShrinkingModalTitle>
        </View>
        <Pressable onPress={onApply} hitSlop={10} style={glassActive ? [styles.headerPill, { overflow: 'visible' }] : styles.headerPill}>
          {glassActive ? (
            <NativeGlassView glassStyle="regular" isInteractive colorScheme="dark" style={[styles.headerPillInner, { paddingHorizontal: 14, borderRadius: 18 }]}>
              <RNText style={styles.headerApplyText} allowFontScaling={false}>{t('common.apply')}</RNText>
            </NativeGlassView>
          ) : (
            <BlurView intensity={80} tint="dark" style={[styles.headerPillInner, { paddingHorizontal: 14 }]}>
              <RNText style={styles.headerApplyText} allowFontScaling={false}>{t('common.apply')}</RNText>
            </BlurView>
          )}
        </Pressable>
      </View>

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }}>
        {/* ── Custom creator ──────────────────────────────────────── */}
        <View style={[styles.sectionHead, { marginTop: 14 }]}>
          <RNText style={[styles.sectionTitle, { color: textTertiary }]} allowFontScaling={false}>
            {t('chat_settings.custom', 'Свой цвет')}
          </RNText>
          {/* Solid / Gradient segmented toggle */}
          <View style={[styles.segment, { borderColor: borderLight }]}>
            {([['solid', 'chat_settings.solid_colors', 'Однотонный'], ['grad', 'chat_settings.gradients', 'Градиент']] as const).map(([k, key, fb]) => {
              const on = (k === 'grad') === customGradient;
              return (
                <Pressable
                  key={k}
                  onPress={() => {
                    triggerHaptic('selection');
                    const grad = k === 'grad';
                    setCustomGradient(grad);
                    applyCustom(grad ? [hslToHex(hue1), hslToHex(hue2)] : [hslToHex(hue1)]);
                  }}
                  style={[styles.segmentBtn, on && { backgroundColor: accent }]}
                >
                  <RNText allowFontScaling={false} style={[styles.segmentText, { color: on ? readableTextOn(accent) : textTertiary }]}>
                    {t(key, fb)}
                  </RNText>
                </Pressable>
              );
            })}
          </View>
        </View>
        <View style={[styles.customCard, { backgroundColor: bgElevated, borderColor: isCustomSel ? accent : borderLight, borderWidth: isCustomSel ? 1.5 : 0.5 }]}>
          <View style={styles.customRow}>
            <View style={[styles.customSwatch, { backgroundColor: hslToHex(hue1) }]} />
            <HueSlider value={hue1} onChange={(h) => { setHue1(h); applyCustom(customGradient ? [hslToHex(h), hslToHex(hue2)] : [hslToHex(h)]); }} />
          </View>
          {customGradient ? (
            <View style={[styles.customRow, { marginTop: 12 }]}>
              <View style={[styles.customSwatch, { backgroundColor: hslToHex(hue2) }]} />
              <HueSlider value={hue2} onChange={(h) => { setHue2(h); applyCustom([hslToHex(hue1), hslToHex(h)]); }} />
            </View>
          ) : null}
        </View>

        {/* ── Opacity ─────────────────────────────────────────────── */}
        <View style={styles.sectionHead}>
          <RNText style={[styles.sectionTitle, { color: textTertiary }]} allowFontScaling={false}>
            {t('chat_settings.opacity', 'Прозрачность')}
          </RNText>
          <RNText style={[styles.sectionValue, { color: textPrimary }]} allowFontScaling={false}>{Math.round(opacity * 100)}%</RNText>
        </View>
        <View style={[styles.sliderCard, { backgroundColor: bgElevated, borderColor: borderLight }]}>
          <ValueSlider min={MIN_OPACITY} max={1} value={opacity} onChange={setOpacity} color={previewColors[0]} trackColor={borderLight} rainbow={false} />
        </View>

        {/* ── Gradient combinations ───────────────────────────────── */}
        <RNText style={[styles.sectionTitle, { color: textTertiary, marginTop: 18, marginBottom: 10 }]} allowFontScaling={false}>
          {t('chat_settings.gradients', 'Комбинации')}
        </RNText>
        <View style={styles.grid}>
          <Pressable onPress={() => pick(null)} style={styles.cellWrap}>
            <View style={[styles.cell, { borderWidth: isThemeSel ? 3 : 0, borderColor: textPrimary }]}>
              <LinearGradient colors={[accent, accent]} style={StyleSheet.absoluteFill} />
              {isThemeSel ? <Feather name="check" size={20} color={readableTextOn(accent)} /> : <Feather name="droplet" size={18} color="#FFFFFF" />}
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
                  {sel ? <Feather name="check" size={20} color="#FFFFFF" /> : <RNText style={styles.cellEmoji} allowFontScaling={false}>{g.emoji}</RNText>}
                </View>
                <RNText style={[styles.cellLabel, { color: textTertiary }]} numberOfLines={1} allowFontScaling={false}>{g.label}</RNText>
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
                <RNText style={[styles.cellLabel, { color: textTertiary }]} numberOfLines={1} allowFontScaling={false}>{sw.label}</RNText>
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

// Generic continuous slider. `rainbow` renders a hue spectrum track (for hue
// pickers); otherwise a flat filled track (for opacity).
function ValueSlider({ min, max, value, onChange, color, trackColor, rainbow }: {
  min: number; max: number; value: number; onChange: (v: number) => void; color: string; trackColor: string; rainbow: boolean;
}) {
  const width = useSharedValue(0);
  const knobX = useSharedValue(0);
  const toX = (v: number, w: number) => ((v - min) / (max - min)) * w;
  const toVal = (x: number, w: number) => min + (Math.max(0, Math.min(x, w)) / w) * (max - min);
  const onLayout = (e: LayoutChangeEvent) => { const w = e.nativeEvent.layout.width; width.value = w; knobX.value = toX(value, w); };
  const commit = (x: number) => { const w = width.value; if (w <= 0) return; onChange(Math.round(toVal(x, w) * 100) / 100); };
  const pan = Gesture.Pan().minDistance(0)
    .onBegin((e) => { 'worklet'; knobX.value = Math.max(0, Math.min(e.x, width.value)); runOnJS(commit)(e.x); })
    .onUpdate((e) => { 'worklet'; knobX.value = Math.max(0, Math.min(e.x, width.value)); runOnJS(commit)(e.x); });
  const filled = useAnimatedStyle(() => ({ width: knobX.value }));
  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: knobX.value - 11 }] }));
  return (
    <GestureDetector gesture={pan}>
      <View style={sliderStyles.container} onLayout={onLayout} collapsable={false}>
        {rainbow ? (
          <LinearGradient colors={RAINBOW} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[sliderStyles.track, { left: 0, right: 0 }]} pointerEvents="none" />
        ) : (
          <>
            <View style={[sliderStyles.track, { backgroundColor: trackColor }]} pointerEvents="none" />
            <Animated.View style={[sliderStyles.track, { left: 0, backgroundColor: color }, filled]} pointerEvents="none" />
          </>
        )}
        <Animated.View style={[sliderStyles.thumb, { borderColor: rainbow ? '#FFFFFF' : color }, thumb]} pointerEvents="none" />
      </View>
    </GestureDetector>
  );
}

function HueSlider({ value, onChange }: { value: number; onChange: (hue: number) => void }) {
  return <ValueSlider min={0} max={360} value={value} onChange={onChange} color="#FFFFFF" trackColor="#888" rainbow />;
}

const sliderStyles = StyleSheet.create({
  container: { flex: 1, height: 36, justifyContent: 'center' },
  track: { position: 'absolute', left: 0, right: 0, height: 6, borderRadius: 3 },
  thumb: {
    position: 'absolute', width: 22, height: 22, borderRadius: 11, backgroundColor: '#FFFFFF', borderWidth: 3,
    top: 7, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 4,
  },
});

const styles = StyleSheet.create({
  root: { flex: 1 },
  headerRow: {
    position: 'absolute', left: 0, right: 0, height: 36, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, zIndex: 100,
  },
  headerPill: { borderRadius: 18, overflow: 'hidden' },
  headerPillInner: { height: 36, minWidth: 36, paddingHorizontal: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  headerTitleAbs: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 60 },
  headerTitlePill: { borderRadius: 18, overflow: 'hidden', maxWidth: '100%' },
  headerTitleInner: { height: 36, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  headerTitleText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  headerApplyText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },

  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, marginBottom: 8 },
  sectionTitle: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  sectionValue: { fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },

  segment: { flexDirection: 'row', borderWidth: 0.5, borderRadius: 10, overflow: 'hidden' },
  segmentBtn: { paddingHorizontal: 12, paddingVertical: 5 },
  segmentText: { fontSize: 12, fontWeight: '600' },

  customCard: { padding: 14, borderRadius: 14 },
  customRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  customSwatch: { width: 30, height: 30, borderRadius: 15 },

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
