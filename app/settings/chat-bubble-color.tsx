/**
 * "Цвет сообщений" — modal message-color picker.
 *
 * Slide-up modal (registered in app/_layout). Floating X / Apply header pills
 * mirror the other chat modals (text-size, bubble-radius). A live
 * ChatPreviewBubbles surface recolors BOTH bubbles as you pick. A "Мои /
 * Собеседника" target toggle chooses which side you're editing. Below: a custom
 * color/gradient creator (hue spectrum sliders), trendy gradient combinations
 * and solid colors rendered as message-bubble tiles, and an opacity slider.
 * Drives the app-wide `chatBubble` (outgoing) + `chatBubbleIn` (incoming)
 * styles on settingsStore (null = theme accent / neutral surface).
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
  BUBBLE_COLORS, GRADIENT_PRESETS, MIN_OPACITY, readableTextOn, hslToHex, hexToHue,
} from '../../src/constants/bubbleColors';
import { triggerHaptic } from '../../src/utils/haptics';
import { useT } from '../../src/i18n/store';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const PREVIEW_HEIGHT = Math.round(SCREEN_HEIGHT * 0.34);
const RAINBOW = ['#FF0000', '#FFFF00', '#00FF00', '#00FFFF', '#0000FF', '#FF00FF', '#FF0000'];

type Side = 'out' | 'in';

function sameColors(a: string[], b: string[]) {
  return a.length === b.length && a.every((c, i) => c === b[i]);
}

export default function ChatBubbleColorScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  const glassActive = useLiquidGlassActive();

  const curOut = useSettingsStore((s) => s.chatBubble);
  const curIn = useSettingsStore((s) => s.chatBubbleIn);
  const setChatBubble = useSettingsStore((s) => s.setChatBubble);
  const setChatBubbleIn = useSettingsStore((s) => s.setChatBubbleIn);
  const getSettings = useChatSettingsStore((s) => s.getSettings);
  const applied = getSettings(GLOBAL_CHAT_SETTINGS_KEY);

  const [target, setTarget] = useState<Side>('out');
  const [pendingOut, setPendingOut] = useState<string[] | null>(curOut?.colors ?? null);
  const [pendingIn, setPendingIn] = useState<string[] | null>(curIn?.colors ?? null);
  const [opOut, setOpOut] = useState<number>(curOut?.opacity ?? 1);
  const [opIn, setOpIn] = useState<number>(curIn?.opacity ?? 1);

  const [customGradient, setCustomGradient] = useState(false);
  const [hue1, setHue1] = useState(210);
  const [hue2, setHue2] = useState(320);

  const accent = theme.colors.accent.primary;
  const tertiary = theme.colors.background.tertiary;

  const activePending = target === 'out' ? pendingOut : pendingIn;
  const setActivePending = (c: string[] | null) => (target === 'out' ? setPendingOut(c) : setPendingIn(c));
  const activeOpacity = target === 'out' ? opOut : opIn;
  const setActiveOpacity = (v: number) => (target === 'out' ? setOpOut(v) : setOpIn(v));

  const customColors = customGradient ? [hslToHex(hue1), hslToHex(hue2)] : [hslToHex(hue1)];

  // Preview fills for each side (null → theme accent / neutral surface).
  const previewOut = pendingOut && pendingOut.length ? pendingOut : [accent];
  const previewOutText = pendingOut && pendingOut.length ? readableTextOn(pendingOut) : '#FFFFFF';

  const onCancel = () => { triggerHaptic('selection'); router.back(); };
  const onApply = () => {
    triggerHaptic('medium');
    setChatBubble(pendingOut && pendingOut.length ? { colors: pendingOut, opacity: opOut } : null);
    setChatBubbleIn(pendingIn && pendingIn.length ? { colors: pendingIn, opacity: opIn } : null);
    router.back();
  };
  const pick = (colors: string[] | null) => { triggerHaptic('selection'); setActivePending(colors); };

  const isDefaultSel = activePending === null;
  const isCustomSel = !!activePending && sameColors(activePending, customColors);
  const bgPrimary = theme.colors.background.primary;
  const bgElevated = theme.colors.background.elevated;
  const textPrimary = theme.colors.text.primary;
  const textTertiary = theme.colors.text.tertiary;
  const borderLight = theme.colors.border.light;

  // A message-bubble-shaped tile (rounded with a tail corre­sponding to the
  // side being edited) — replaces the old circles for a Telegram-like read.
  const Tile = ({ colors, selected, emoji, label, onPress, defaultFill }: {
    colors: string[] | null; selected: boolean; emoji?: string; label: string; onPress: () => void; defaultFill?: string;
  }) => {
    const grad = colors && colors.length > 1;
    const solid = colors && colors.length === 1 ? colors[0] : undefined;
    const fill = colors ? undefined : defaultFill;
    const tail = target === 'out'
      ? { borderBottomRightRadius: 5 }
      : { borderBottomLeftRadius: 5 };
    const checkColor = readableTextOn(colors ? colors : (defaultFill || accent));
    return (
      <Pressable onPress={onPress} style={styles.tileWrap}>
        <View style={[styles.tile, tail, { borderColor: textPrimary, borderWidth: selected ? 2.5 : 0, backgroundColor: solid || fill || 'transparent' }]}>
          {grad ? (
            <LinearGradient colors={colors as any} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
          ) : null}
          {selected ? <Feather name="check" size={18} color={checkColor} /> : (emoji ? <RNText style={styles.tileEmoji} allowFontScaling={false}>{emoji}</RNText> : null)}
        </View>
        <RNText style={[styles.tileLabel, { color: textTertiary }]} numberOfLines={1} allowFontScaling={false}>{label}</RNText>
      </Pressable>
    );
  };

  return (
    <View style={[styles.root, { backgroundColor: bgPrimary }]}>
      <ChatPreviewBubbles
        height={PREVIEW_HEIGHT}
        fontSize={applied.fontSize}
        fontFamily={applied.fontFamily === 'mono' ? 'monospace' : applied.fontFamily === 'serif' ? 'serif' : undefined}
        bubbleRadius={applied.bubbleRadius}
        backgroundImage={applied.backgroundImage}
        topPadding={72}
        bubbleColors={previewOut}
        bubbleOpacity={opOut}
        bubbleTextColor={previewOutText}
        inColors={pendingIn || []}
        inOpacity={opIn}
        inTextColor={pendingIn && pendingIn.length ? readableTextOn(pendingIn) : undefined}
      />

      {/* ── Floating header pills (X / title / Apply) — top:28 like the
          other chat modals so the controls sit at the same level. ─────── */}
      <View style={[styles.headerRow, { top: 28 }]} pointerEvents="box-none">
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
                  <RNText style={styles.headerTitleText} allowFontScaling={false} numberOfLines={1}>{t('chat_settings.message_color', 'Цвет сообщений')}</RNText>
                </View>
              ) : (
                <BlurView intensity={80} tint="dark" style={styles.headerTitleInner}>
                  <RNText style={styles.headerTitleText} allowFontScaling={false} numberOfLines={1}>{t('chat_settings.message_color', 'Цвет сообщений')}</RNText>
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

      {/* Target toggle: which side am I editing? */}
      <View style={styles.targetRow}>
        <View style={[styles.targetSeg, { backgroundColor: bgElevated, borderColor: borderLight }]}>
          {([['out', 'chat_settings.side_mine', 'Мои'], ['in', 'chat_settings.side_peer', 'Собеседника']] as const).map(([k, key, fb]) => {
            const on = target === k;
            return (
              <Pressable key={k} onPress={() => { triggerHaptic('selection'); setTarget(k); }} style={[styles.targetBtn, on && { backgroundColor: accent }]}>
                <RNText allowFontScaling={false} style={[styles.targetText, { color: on ? readableTextOn(accent) : textPrimary }]}>{t(key, fb)}</RNText>
              </Pressable>
            );
          })}
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }}>
        {/* ── Custom creator ──────────────────────────────────────── */}
        <View style={[styles.sectionHead, { marginTop: 6 }]}>
          <RNText style={[styles.sectionTitle, { color: textTertiary }]} allowFontScaling={false}>{t('chat_settings.custom', 'Свой цвет')}</RNText>
          <View style={[styles.segment, { borderColor: borderLight }]}>
            {([['solid', 'chat_settings.solid_colors', 'Однотонный'], ['grad', 'chat_settings.gradients', 'Градиент']] as const).map(([k, key, fb]) => {
              const on = (k === 'grad') === customGradient;
              return (
                <Pressable key={k} onPress={() => { triggerHaptic('selection'); const g = k === 'grad'; setCustomGradient(g); setActivePending(g ? [hslToHex(hue1), hslToHex(hue2)] : [hslToHex(hue1)]); }} style={[styles.segmentBtn, on && { backgroundColor: accent }]}>
                  <RNText allowFontScaling={false} style={[styles.segmentText, { color: on ? readableTextOn(accent) : textTertiary }]}>{t(key, fb)}</RNText>
                </Pressable>
              );
            })}
          </View>
        </View>
        <View style={[styles.customCard, { backgroundColor: bgElevated, borderColor: isCustomSel ? accent : borderLight, borderWidth: isCustomSel ? 1.5 : 0.5 }]}>
          <View style={styles.customRow}>
            <View style={[styles.customSwatch, { backgroundColor: hslToHex(hue1) }]} />
            <HueSlider value={hue1} onChange={(h) => { setHue1(h); setActivePending(customGradient ? [hslToHex(h), hslToHex(hue2)] : [hslToHex(h)]); }} />
          </View>
          {customGradient ? (
            <View style={[styles.customRow, { marginTop: 12 }]}>
              <View style={[styles.customSwatch, { backgroundColor: hslToHex(hue2) }]} />
              <HueSlider value={hue2} onChange={(h) => { setHue2(h); setActivePending([hslToHex(hue1), hslToHex(h)]); }} />
            </View>
          ) : null}
        </View>

        {/* ── Opacity ─────────────────────────────────────────────── */}
        <View style={styles.sectionHead}>
          <RNText style={[styles.sectionTitle, { color: textTertiary }]} allowFontScaling={false}>{t('chat_settings.opacity', 'Прозрачность')}</RNText>
          <RNText style={[styles.sectionValue, { color: textPrimary }]} allowFontScaling={false}>{Math.round(activeOpacity * 100)}%</RNText>
        </View>
        <View style={[styles.sliderCard, { backgroundColor: bgElevated, borderColor: borderLight }]}>
          <ValueSlider min={MIN_OPACITY} max={1} value={activeOpacity} onChange={setActiveOpacity} color={(activePending && activePending[0]) || accent} trackColor={borderLight} rainbow={false} />
        </View>

        {/* ── Gradient combinations ───────────────────────────────── */}
        <RNText style={[styles.sectionTitle, { color: textTertiary, marginTop: 18, marginBottom: 10 }]} allowFontScaling={false}>{t('chat_settings.gradients', 'Комбинации')}</RNText>
        <View style={styles.grid}>
          <Tile
            colors={null}
            defaultFill={target === 'out' ? accent : tertiary}
            selected={isDefaultSel}
            emoji={undefined}
            label={target === 'out' ? t('chat_settings.bubble_color.theme', 'Тема') : t('chat_settings.default', 'Обычный')}
            onPress={() => pick(null)}
          />
          {GRADIENT_PRESETS.map((g) => (
            <Tile
              key={g.key}
              colors={[...g.colors]}
              selected={!!activePending && sameColors(activePending, g.colors)}
              emoji={g.emoji}
              label={g.label}
              onPress={() => pick([...g.colors])}
            />
          ))}
        </View>

        {/* ── Solid colors ────────────────────────────────────────── */}
        <RNText style={[styles.sectionTitle, { color: textTertiary, marginTop: 18, marginBottom: 10 }]} allowFontScaling={false}>{t('chat_settings.solid_colors', 'Однотонные')}</RNText>
        <View style={styles.grid}>
          {BUBBLE_COLORS.map((sw) => (
            <Tile
              key={sw.key}
              colors={[sw.color]}
              selected={!!activePending && activePending.length === 1 && activePending[0] === sw.color}
              label={sw.label}
              onPress={() => pick([sw.color])}
            />
          ))}
        </View>
      </ScrollView>

      {/* Footer */}
      <View style={[styles.footerRow, { paddingBottom: insets.bottom + 12, paddingHorizontal: 16, backgroundColor: bgPrimary, borderTopColor: borderLight }]}>
        <Pressable onPress={onCancel} style={[styles.footerBtn, { backgroundColor: bgElevated, borderColor: borderLight }]}>
          <RNText allowFontScaling={false} style={[styles.footerBtnText, { color: textPrimary }]}>{t('common.cancel')}</RNText>
        </Pressable>
        <Pressable onPress={onApply} style={[styles.footerBtn, { backgroundColor: previewOut[0], borderColor: previewOut[0] }]}>
          <RNText allowFontScaling={false} style={[styles.footerBtnText, { color: previewOutText }]}>{t('common.apply')}</RNText>
        </Pressable>
      </View>
    </View>
  );
}

// Generic continuous slider. `rainbow` renders a hue spectrum track.
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

  targetRow: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4, alignItems: 'center' },
  targetSeg: { flexDirection: 'row', borderRadius: 12, borderWidth: 0.5, padding: 3 },
  targetBtn: { paddingHorizontal: 20, paddingVertical: 7, borderRadius: 9 },
  targetText: { fontSize: 13, fontWeight: '600' },

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
  tileWrap: { width: '25%', alignItems: 'center', gap: 5 },
  tile: {
    width: 58, height: 40, borderRadius: 16, overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2,
  },
  tileEmoji: { fontSize: 18 },
  tileLabel: { fontSize: 10, fontWeight: '500' },

  footerRow: { flexDirection: 'row', gap: 10, paddingTop: 10, borderTopWidth: 0.5 },
  footerBtn: { flex: 1, paddingVertical: 14, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 0.5 },
  footerBtnText: { fontSize: 15, fontWeight: '600' },
});
