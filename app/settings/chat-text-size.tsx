/**
 * Telegram-style fullscreen "Chat text size" preview modal.
 *
 * Mirrors app/settings/fonts-size.tsx visually but drives the chat-specific
 * fontSize stored in chatSettingsStore.settings[id], so the preview shows
 * exactly how chat bubbles will look once Apply is pressed. Cancel / X /
 * back gesture all exit without persisting.
 *
 * Uses ChatPreviewBubbles for the live bubble area so every chat-flow
 * modal stays visually identical.
 */

import React, { useState, useMemo } from 'react';
import {
  View,
  Pressable,
  StyleSheet,
  Text as RNText,
  Dimensions,
  LayoutChangeEvent,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
import { ChatPreviewBubbles } from '../../src/components/ui/ChatPreviewBubbles';
import {
  useChatSettingsStore,
  GLOBAL_CHAT_SETTINGS_KEY,
} from '../../src/store/chatSettingsStore';
import { triggerHaptic } from '../../src/utils/haptics';
import { useT } from '../../src/i18n/store';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const PREVIEW_HEIGHT = Math.round(SCREEN_HEIGHT * 0.6);

// Discrete sizes the user can pick. Tight 1-pt steps in the body range with
// two larger options at the top so accessibility-leaning users have a real
// "big" choice without making the slider feel mushy in the middle.
const CHAT_FONT_SIZES = [12, 13, 14, 15, 16, 17, 18, 20, 22] as const;

export default function ChatTextSizeScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const chatId = id || GLOBAL_CHAT_SETTINGS_KEY;

  const getSettings = useChatSettingsStore((s) => s.getSettings);
  const updateSettings = useChatSettingsStore((s) => s.updateSettings);
  // Read once on mount — preview drives off pendingIndex from there on.
  const applied = useMemo(() => getSettings(chatId), [chatId, getSettings]);

  const initialIndex = (() => {
    // Pick the closest tick to the currently-applied size so the slider lands
    // on the correct mark when the user opens the modal.
    let best = 0;
    let bestDelta = Infinity;
    CHAT_FONT_SIZES.forEach((s, i) => {
      const d = Math.abs(s - applied.fontSize);
      if (d < bestDelta) { bestDelta = d; best = i; }
    });
    return best;
  })();

  const [pendingIndex, setPendingIndex] = useState<number>(initialIndex);
  const pendingSize = CHAT_FONT_SIZES[pendingIndex] ?? 15;

  const onCancel = () => {
    triggerHaptic('selection');
    router.back();
  };

  const onApply = () => {
    triggerHaptic('medium');
    if (pendingSize !== applied.fontSize) {
      updateSettings(chatId, { fontSize: pendingSize });
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
  const textTertiary = theme.colors.text.tertiary;
  const borderLight = theme.colors.border.light;

  return (
    <View style={[styles.root, { backgroundColor: bgPrimary }]}>
      <ChatPreviewBubbles
        height={PREVIEW_HEIGHT}
        fontSize={pendingSize}
        fontFamily={applied.fontFamily === 'mono' ? 'monospace' : applied.fontFamily === 'serif' ? 'serif' : undefined}
        bubbleRadius={applied.bubbleRadius}
        backgroundImage={applied.backgroundImage}
        topPadding={insets.top + 60}
      />

      {/* ── Floating header pills ───────────────────────────────────── */}
      <View style={[styles.headerRow, { top: 28 }]} pointerEvents="box-none">
        <Pressable onPress={onCancel} hitSlop={10} style={styles.headerPill}>
          <BlurView intensity={80} tint="dark" style={styles.headerPillInner}>
            <Feather name="x" size={18} color="#FFFFFF" />
          </BlurView>
        </Pressable>
        <View style={styles.headerTitleAbs} pointerEvents="box-none">
          <ShrinkingModalTitle>
            <View style={styles.headerTitlePill}>
              <BlurView intensity={80} tint="dark" style={styles.headerTitleInner}>
                <RNText style={styles.headerTitleText} allowFontScaling={false} numberOfLines={1} ellipsizeMode="tail">
                  {t('chat_settings.font_size')}
                </RNText>
              </BlurView>
            </View>
          </ShrinkingModalTitle>
        </View>
        <Pressable onPress={onApply} hitSlop={10} style={styles.headerPill}>
          <BlurView intensity={80} tint="dark" style={[styles.headerPillInner, { paddingHorizontal: 14 }]}>
            <RNText style={styles.headerApplyText} allowFontScaling={false}>
              {t('common.apply')}
            </RNText>
          </BlurView>
        </Pressable>
      </View>

      {/* ── Controls + footer ───────────────────────────────────────── */}
      <View style={[styles.controlsWrap, { paddingBottom: insets.bottom + 16 }]}>
        <View
          style={[
            styles.sliderCard,
            { backgroundColor: bgElevated, borderColor: borderLight },
          ]}
        >
          <RNText allowFontScaling={false} style={[styles.sliderASmall, { color: textTertiary }]}>
            A
          </RNText>
          <View style={styles.sliderTrackHost}>
            <DiscreteSlider
              tickCount={CHAT_FONT_SIZES.length}
              activeIndex={pendingIndex}
              onSelect={onSelectIndex}
              accent={accent}
              trackColor={borderLight}
              tickColor={textTertiary}
            />
          </View>
          <RNText allowFontScaling={false} style={[styles.sliderALarge, { color: textPrimary }]}>
            A
          </RNText>
        </View>

        <View style={styles.footerRow}>
          <Pressable
            onPress={onCancel}
            style={[styles.footerBtn, { backgroundColor: bgElevated, borderColor: borderLight }]}
          >
            <RNText allowFontScaling={false} style={[styles.footerBtnText, { color: textPrimary }]}>
              {t('common.cancel')}
            </RNText>
          </Pressable>
          <Pressable
            onPress={onApply}
            style={[styles.footerBtn, { backgroundColor: accent, borderColor: accent }]}
          >
            <RNText allowFontScaling={false} style={[styles.footerBtnText, { color: '#FFFFFF' }]}>
              {t('common.apply')}
            </RNText>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

// ─── Reanimated discrete-tick slider ───────────────────────────────────────
//
// Identical worklet-driven slider used by chat-text-size and chat-bubble-radius.
// Lives here (rather than as a shared util) because there's only two callers
// and inlining keeps the import graph simple. If a third caller appears,
// promote it to src/components/ui.
//
function DiscreteSlider({
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

  const filledStyle = useAnimatedStyle(() => ({ width: knobX.value }));
  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: knobX.value - SLIDER_THUMB_SIZE / 2 }],
  }));

  return (
    <GestureDetector gesture={pan}>
      <View style={sliderStyles.container} onLayout={onLayout} collapsable={false}>
        <View style={[sliderStyles.track, { backgroundColor: trackColor }]} pointerEvents="none" />
        <Animated.View
          style={[sliderStyles.track, sliderStyles.filled, { backgroundColor: accent }, filledStyle]}
          pointerEvents="none"
        />
        {Array.from({ length: tickCount }).map((_, i) => {
          const pct = tickCount > 1 ? (i / (tickCount - 1)) * 100 : 0;
          return (
            <View
              key={i}
              style={[sliderStyles.tick, { left: `${pct}%`, backgroundColor: tickColor }]}
              pointerEvents="none"
            />
          );
        })}
        <Animated.View
          style={[sliderStyles.thumb, { backgroundColor: '#FFFFFF', borderColor: accent }, thumbStyle]}
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
  container: { flex: 1, height: SLIDER_HEIGHT, justifyContent: 'center' },
  track: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: SLIDER_TRACK_HEIGHT,
    borderRadius: SLIDER_TRACK_HEIGHT / 2,
  },
  filled: { right: undefined, left: 0 },
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
  headerPill: { borderRadius: 18, overflow: 'hidden' },
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
  headerTitlePill: { borderRadius: 18, overflow: 'hidden', maxWidth: '100%' },
  headerTitleInner: {
    height: 36,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  headerApplyText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },

  // Controls + footer
  controlsWrap: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 12,
    justifyContent: 'flex-start',
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
  sliderASmall: { fontSize: 14, fontWeight: '500', width: 18, textAlign: 'center' },
  sliderALarge: { fontSize: 22, fontWeight: '600', width: 18, textAlign: 'center' },
  sliderTrackHost: { flex: 1, height: SLIDER_HEIGHT, justifyContent: 'center' },
  footerRow: { flexDirection: 'row', gap: 10, marginTop: 'auto' },
  footerBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0.5,
  },
  footerBtnText: { fontSize: 15, fontWeight: '600' },
});
