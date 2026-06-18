/**
 * Telegram-style fullscreen "Text size" preview modal.
 *
 * Layout (top → bottom):
 *   1. Floating blur header pills — X (cancel) / title / Apply
 *   2. Chat preview area (~60% of screen) — user's chat wallpaper as the
 *      backdrop, with two fake chat bubbles + a date pill on top. Bubble
 *      text is rendered with the LIVE pending size, so dragging the slider
 *      updates the preview in real time.
 *   3. "Системный размер текста" toggle row
 *   4. Custom Reanimated slider (small A → large A) with one tick per
 *      FONT_SIZES entry. Snaps on release.
 *   5. Footer — Cancel / Apply (equal-width).
 *
 * Only commits the pending size to themeStore on Apply. Cancel and the X
 * pill exit without persisting anything.
 */

import React, { useState } from 'react';
import {
  View,
  Pressable,
  StyleSheet,
  Text as RNText,
  Switch,
  Dimensions,
  LayoutChangeEvent,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useTheme } from '../../src/theme';
import { ShrinkingModalTitle } from '../../src/components/ui';
import { useLiquidGlassActive, GlassBg } from '../../src/components/ui/LiquidGlass';
import { CachedImage } from '../../src/components/ui/CachedImage';
import {
  useThemeStore,
  FONT_SIZES,
  FontSize,
} from '../../src/store/themeStore';
import {
  useChatSettingsStore,
  GLOBAL_CHAT_SETTINGS_KEY,
} from '../../src/store/chatSettingsStore';
import { triggerHaptic } from '../../src/utils/haptics';
import { useT } from '../../src/i18n/store';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const PREVIEW_HEIGHT = Math.round(SCREEN_HEIGHT * 0.6);

// Base body font size used for the preview bubble text. The current scale
// FONT_SIZES.scale multiplies this so the preview really shows what the
// chat bubbles will look like once applied.
const PREVIEW_BASE_FONT = 15;

export default function FontsSizeScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  const glassActive = useLiquidGlassActive();
  const currentSize = useThemeStore((s) => s.fontSize);
  const setFontSize = useThemeStore((s) => s.setFontSize);
  const wallpaper = useChatSettingsStore(
    (s) => s.settings[GLOBAL_CHAT_SETTINGS_KEY]?.backgroundImage,
  );

  // Pending state (uncommitted) — only flushed to themeStore on Apply.
  const [pendingIndex, setPendingIndex] = useState<number>(() => {
    const idx = FONT_SIZES.findIndex((f) => f.key === currentSize);
    return idx >= 0 ? idx : 1;
  });
  const [systemSize, setSystemSize] = useState(false);

  const pending = FONT_SIZES[pendingIndex] ?? FONT_SIZES[1];
  // When system-size mode is on we still preview against the medium scale
  // (1.0) and let RN font scaling stretch the text per the OS setting.
  const previewScale = systemSize ? 1.0 : pending.scale;
  const previewFontSize = PREVIEW_BASE_FONT * previewScale;

  const handleCancel = () => {
    triggerHaptic('selection');
    router.back();
  };

  const handleApply = () => {
    triggerHaptic('medium');
    if (!systemSize) {
      const key = pending.key as FontSize;
      if (key !== currentSize) setFontSize(key);
    }
    router.back();
  };

  const onSelectIndex = (idx: number) => {
    if (idx !== pendingIndex) {
      triggerHaptic('selection');
      setPendingIndex(idx);
    }
  };

  const bgPrimary = theme.colors.background.primary;
  const bgElevated = theme.colors.background.elevated;
  const accent = theme.colors.accent.primary;
  const textPrimary = theme.colors.text.primary;
  const textSecondary = theme.colors.text.secondary;
  const textTertiary = theme.colors.text.tertiary;
  const borderLight = theme.colors.border.light;

  return (
    <View style={[styles.root, { backgroundColor: bgPrimary }]}>
      {/* Chat preview area (fills the top of the screen up to ~60%) */}
      <View style={[styles.previewWrap, { height: PREVIEW_HEIGHT, backgroundColor: theme.colors.background.secondary }]}>
        {wallpaper ? (
          <CachedImage
            uri={wallpaper}
            style={StyleSheet.absoluteFillObject}
            resizeMode="cover"
            proxyWidth={800}
          />
        ) : null}
        {/* Soft fade at the bottom so the preview blends into the controls */}
        <LinearGradient
          colors={['transparent', bgPrimary]}
          locations={[0.7, 1]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        {/* Fake chat */}
        <View style={[styles.bubblesPad, { paddingTop: insets.top + 60 }]}>
          {/* Date pill */}
          <View style={styles.datePillWrap}>
            <View style={styles.datePill}>
              <RNText
                allowFontScaling={systemSize}
                style={styles.datePillText}
              >
                {t('fonts.preview.today')}
              </RNText>
            </View>
          </View>
          {/* Incoming bubble with quoted-reply */}
          <View style={[styles.bubbleRow, { alignSelf: 'flex-start' }]}>
            <View
              style={[
                styles.bubble,
                {
                  backgroundColor: theme.colors.background.tertiary,
                  borderBottomLeftRadius: 4,
                },
              ]}
            >
              <View
                style={[
                  styles.replyBlock,
                  { borderLeftColor: accent, backgroundColor: accent + '15' },
                ]}
              >
                <RNText
                  allowFontScaling={systemSize}
                  style={[styles.replyName, { color: accent, fontSize: previewFontSize - 3 }]}
                  numberOfLines={1}
                >
                  {t('chat.peer', 'Собеседник')}
                </RNText>
                <RNText
                  allowFontScaling={systemSize}
                  style={[styles.replyText, { color: textSecondary, fontSize: previewFontSize - 3 }]}
                  numberOfLines={1}
                >
                  {t('chat_settings.preview.msg1', 'Привет! Как дела? 😊')}
                </RNText>
              </View>
              <RNText
                allowFontScaling={systemSize}
                style={[
                  styles.bubbleText,
                  { color: textPrimary, fontSize: previewFontSize },
                ]}
              >
                {t('chat_settings.preview.msg2', 'Всё отлично, спасибо!')}
              </RNText>
              <RNText
                allowFontScaling={systemSize}
                style={[
                  styles.bubbleTime,
                  { color: textTertiary, fontSize: Math.max(9, previewFontSize - 5) },
                ]}
              >
                12:31
              </RNText>
            </View>
          </View>
          {/* Outgoing bubble */}
          <View style={[styles.bubbleRow, { alignSelf: 'flex-end' }]}>
            <View
              style={[
                styles.bubble,
                {
                  backgroundColor: accent,
                  borderBottomRightRadius: 4,
                },
              ]}
            >
              <RNText
                allowFontScaling={systemSize}
                style={[
                  styles.bubbleText,
                  { color: '#FFFFFF', fontSize: previewFontSize },
                ]}
              >
                {t('chat_settings.preview.msg3', 'Давай встретимся завтра?')}
              </RNText>
              <RNText
                allowFontScaling={systemSize}
                style={[
                  styles.bubbleTime,
                  {
                    color: 'rgba(255,255,255,0.7)',
                    fontSize: Math.max(9, previewFontSize - 5),
                  },
                ]}
              >
                12:32
              </RNText>
            </View>
          </View>
        </View>
      </View>

      {/* ── Floating header pills ───────────────────────────────────── */}
      <View style={[styles.headerRow, { top: 28 }]} pointerEvents="box-none">
        <Pressable onPress={handleCancel} hitSlop={10} style={styles.headerPill}>
          {glassActive ? (
            <View style={[styles.headerPillInner, { borderRadius: 18, overflow: 'hidden' }]}>
              <GlassBg borderRadius={18} colorScheme="dark" />
              <Feather name="x" size={18} color="#FFFFFF" />
            </View>
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
                  <RNText
                    style={styles.headerTitleText}
                    allowFontScaling={false}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                  >
                    {t('fonts.size_title')}
                  </RNText>
                </View>
              ) : (
                <BlurView intensity={80} tint="dark" style={styles.headerTitleInner}>
                  <RNText
                    style={styles.headerTitleText}
                    allowFontScaling={false}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                  >
                    {t('fonts.size_title')}
                  </RNText>
                </BlurView>
              )}
            </View>
          </ShrinkingModalTitle>
        </View>
        <Pressable onPress={handleApply} hitSlop={10} style={styles.headerPill}>
          {glassActive ? (
            <View style={[styles.headerPillInner, { paddingHorizontal: 14, borderRadius: 18, overflow: 'hidden' }]}>
              <GlassBg borderRadius={18} colorScheme="dark" />
              <RNText style={styles.headerApplyText} allowFontScaling={false}>
                {t('common.apply')}
              </RNText>
            </View>
          ) : (
            <BlurView intensity={80} tint="dark" style={[styles.headerPillInner, { paddingHorizontal: 14 }]}>
              <RNText style={styles.headerApplyText} allowFontScaling={false}>
                {t('common.apply')}
              </RNText>
            </BlurView>
          )}
        </Pressable>
      </View>

      {/* ── Controls + footer ───────────────────────────────────────── */}
      <View style={[styles.controlsWrap, { paddingBottom: insets.bottom + 16 }]}>
        {/* System size toggle row */}
        <View
          style={[
            styles.toggleRow,
            { backgroundColor: bgElevated, borderColor: borderLight },
          ]}
        >
          <RNText
            allowFontScaling={false}
            style={[styles.toggleLabel, { color: textPrimary }]}
          >
            {t('fonts.system_size')}
          </RNText>
          <Switch
            value={systemSize}
            onValueChange={(v) => {
              triggerHaptic('selection');
              setSystemSize(v);
            }}
            trackColor={{ false: borderLight, true: accent }}
            thumbColor="#FFFFFF"
          />
        </View>

        {/* Slider row */}
        <View
          style={[
            styles.sliderCard,
            { backgroundColor: bgElevated, borderColor: borderLight, opacity: systemSize ? 0.5 : 1 },
          ]}
          pointerEvents={systemSize ? 'none' : 'auto'}
        >
          <RNText
            allowFontScaling={false}
            style={[styles.sliderASmall, { color: textTertiary }]}
          >
            A
          </RNText>
          <View style={styles.sliderTrackHost}>
            <FontSizeSlider
              tickCount={FONT_SIZES.length}
              activeIndex={pendingIndex}
              onSelect={onSelectIndex}
              accent={accent}
              trackColor={borderLight}
              tickColor={textTertiary}
            />
          </View>
          <RNText
            allowFontScaling={false}
            style={[styles.sliderALarge, { color: textPrimary }]}
          >
            A
          </RNText>
        </View>

        {/* Footer — Cancel / Apply */}
        <View style={styles.footerRow}>
          <Pressable
            onPress={handleCancel}
            style={[
              styles.footerBtn,
              { backgroundColor: bgElevated, borderColor: borderLight },
            ]}
          >
            <RNText
              allowFontScaling={false}
              style={[styles.footerBtnText, { color: textPrimary }]}
            >
              {t('common.cancel')}
            </RNText>
          </Pressable>
          <Pressable
            onPress={handleApply}
            style={[styles.footerBtn, { backgroundColor: accent, borderColor: accent }]}
          >
            <RNText
              allowFontScaling={false}
              style={[styles.footerBtnText, { color: '#FFFFFF' }]}
            >
              {t('common.apply')}
            </RNText>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

// ─── Custom Reanimated slider ──────────────────────────────────────────────
//
// Worklet-driven slider with a thumb that snaps to discrete tick marks.
// All animation runs on the UI thread via SharedValues; React state is only
// updated once per snap (runOnJS) so no re-render fires while dragging.
//
// Why hand-rolled: the spec forbids new native deps, and React Native's
// own Slider isn't installed. RNGH + Reanimated are already in the bundle,
// so a 60-line custom slider stays cheap on weak devices.
//
function FontSizeSlider({
  tickCount,
  activeIndex,
  onSelect,
  accent,
  trackColor,
  tickColor,
}: {
  tickCount: number;
  activeIndex: number;
  onSelect: (idx: number) => void;
  accent: string;
  trackColor: string;
  tickColor: string;
}) {
  const sliderWidth = useSharedValue(0);
  const knobX = useSharedValue(0);

  // Sync knobX to the active index whenever the parent updates it (e.g. on
  // first mount, or when the parent state changes for some other reason).
  React.useEffect(() => {
    if (sliderWidth.value > 0 && tickCount > 1) {
      const step = sliderWidth.value / (tickCount - 1);
      knobX.value = withSpring(activeIndex * step, { damping: 20, stiffness: 220 });
    }
  }, [activeIndex, tickCount]);

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    sliderWidth.value = w;
    if (tickCount > 1) {
      // Set initial knob position once the layout is known
      const step = w / (tickCount - 1);
      knobX.value = activeIndex * step;
    }
  };

  const clamp = (v: number, lo: number, hi: number) => {
    'worklet';
    return Math.max(lo, Math.min(hi, v));
  };

  const pan = Gesture.Pan()
    .minDistance(0)
    .onBegin((e) => {
      'worklet';
      knobX.value = clamp(e.x, 0, sliderWidth.value);
    })
    .onUpdate((e) => {
      'worklet';
      knobX.value = clamp(e.x, 0, sliderWidth.value);
    })
    .onEnd(() => {
      'worklet';
      const w = sliderWidth.value;
      if (w <= 0 || tickCount <= 1) return;
      const step = w / (tickCount - 1);
      const idx = Math.round(knobX.value / step);
      knobX.value = withSpring(idx * step, { damping: 18, stiffness: 200 });
      runOnJS(onSelect)(idx);
    });

  const filledStyle = useAnimatedStyle(() => ({
    width: knobX.value,
  }));
  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: knobX.value - SLIDER_THUMB_SIZE / 2 }],
  }));

  return (
    <GestureDetector gesture={pan}>
      <View style={sliderStyles.container} onLayout={onLayout} collapsable={false}>
        {/* Background track */}
        <View
          style={[sliderStyles.track, { backgroundColor: trackColor }]}
          pointerEvents="none"
        />
        {/* Filled track up to the knob */}
        <Animated.View
          style={[
            sliderStyles.track,
            sliderStyles.filled,
            { backgroundColor: accent },
            filledStyle,
          ]}
          pointerEvents="none"
        />
        {/* Tick marks */}
        {Array.from({ length: tickCount }).map((_, i) => {
          const pct = tickCount > 1 ? (i / (tickCount - 1)) * 100 : 0;
          return (
            <View
              key={i}
              style={[
                sliderStyles.tick,
                {
                  left: `${pct}%`,
                  backgroundColor: tickColor,
                },
              ]}
              pointerEvents="none"
            />
          );
        })}
        {/* Thumb */}
        <Animated.View
          style={[
            sliderStyles.thumb,
            { backgroundColor: '#FFFFFF', borderColor: accent },
            thumbStyle,
          ]}
          pointerEvents="none"
        />
      </View>
    </GestureDetector>
  );
}

const SLIDER_HEIGHT = 36;
const SLIDER_THUMB_SIZE = 22;
const SLIDER_TRACK_HEIGHT = 4;
const SLIDER_TICK_SIZE = 8;

const sliderStyles = StyleSheet.create({
  container: {
    flex: 1,
    height: SLIDER_HEIGHT,
    justifyContent: 'center',
  },
  track: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: SLIDER_TRACK_HEIGHT,
    borderRadius: SLIDER_TRACK_HEIGHT / 2,
  },
  filled: {
    right: undefined,
    left: 0,
  },
  tick: {
    position: 'absolute',
    width: SLIDER_TICK_SIZE,
    height: SLIDER_TICK_SIZE,
    borderRadius: SLIDER_TICK_SIZE / 2,
    marginLeft: -SLIDER_TICK_SIZE / 2,
    top: SLIDER_HEIGHT / 2 - SLIDER_TICK_SIZE / 2,
  },
  thumb: {
    position: 'absolute',
    width: SLIDER_THUMB_SIZE,
    height: SLIDER_THUMB_SIZE,
    borderRadius: SLIDER_THUMB_SIZE / 2,
    borderWidth: 2,
    top: SLIDER_HEIGHT / 2 - SLIDER_THUMB_SIZE / 2,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
});

const styles = StyleSheet.create({
  root: { flex: 1 },
  previewWrap: {
    width: '100%',
    overflow: 'hidden',
  },
  bubblesPad: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    gap: 8,
  },
  datePillWrap: {
    alignItems: 'center',
    marginBottom: 12,
  },
  datePill: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  datePillText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '500',
  },
  bubbleRow: {
    maxWidth: '78%',
    marginBottom: 6,
  },
  bubble: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
  },
  bubbleText: {
    fontWeight: '400',
  },
  bubbleTime: {
    marginTop: 3,
    alignSelf: 'flex-end',
    fontVariant: ['tabular-nums'],
  },
  replyBlock: {
    borderLeftWidth: 2,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginBottom: 6,
  },
  replyName: {
    fontWeight: '600',
  },
  replyText: {
    marginTop: 1,
  },
  // Floating header
  headerRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    zIndex: 100,
  },
  headerPill: {
    borderRadius: 18,
    overflow: 'hidden',
  },
  headerPillInner: {
    height: 36,
    minWidth: 36,
    paddingHorizontal: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  headerTitleAbs: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 60,
  },
  headerTitlePill: {
    borderRadius: 18,
    overflow: 'hidden',
    maxWidth: '100%',
  },
  headerTitleInner: {
    height: 36,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  headerApplyText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  // Controls + footer
  controlsWrap: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 12,
    justifyContent: 'flex-start',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 0.5,
  },
  toggleLabel: {
    fontSize: 15,
    flex: 1,
    marginRight: 12,
  },
  sliderCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 0.5,
    gap: 12,
  },
  sliderASmall: {
    fontSize: 14,
    fontWeight: '500',
    width: 18,
    textAlign: 'center',
  },
  sliderALarge: {
    fontSize: 22,
    fontWeight: '600',
    width: 18,
    textAlign: 'center',
  },
  sliderTrackHost: {
    flex: 1,
    height: SLIDER_HEIGHT,
    justifyContent: 'center',
  },
  footerRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 'auto',
  },
  footerBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0.5,
  },
  footerBtnText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
