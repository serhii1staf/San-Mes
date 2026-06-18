/**
 * DynamicOverlayHost — Liquid-Glass companion pill that wraps the notch.
 *
 * Two visual states driven by a single shared value (`progress`, 0 → 1):
 *
 *   - Collapsed (progress = 0): ~290 × 36 pill centred horizontally just
 *     below the notch. Shows avatar / display name / theme dot / pixel
 *     icon thumb / chevron-down / X.
 *   - Expanded  (progress = 1): full-width-minus-margins card, ~58% of
 *     screen height. Same pill content row at the top, then a 3 × 2
 *     dashboard of glass tiles with REAL previews of the content they
 *     represent (theme, icon, notifications, fps, mode, perf monitor).
 *
 * The host fully unmounts when `visible === false` so when dismissed
 * there's literally nothing on the tree — zero idle cost. Long-press the
 * Home tab in the bottom navigation to summon it.
 *
 * Critical UX rules (user-driven):
 *  - The overlay NEVER dims or blocks the rest of the UI when collapsed.
 *    Only the pill itself catches touches; everything outside passes
 *    through to the underlying screen.
 *  - When EXPANDED, a transparent (no scrim) tap-region behind the card
 *    catches taps that fall outside the card and dismisses smoothly. No
 *    visible darkening — just dismiss-on-outside-tap behaviour.
 *  - Dismiss is always animated: collapse the morph back to pill (single
 *    spring), then float UP and fade out. Never a hard cut. If the user
 *    triggered dismiss via a destination tap (Theme tile, Notifications,
 *    etc.), the navigation kicks off AFTER the visible exit animation
 *    completes — no closing artifact behind the slide-in.
 *  - Tile contents show real previews — theme tile renders a tiny
 *    mockup of the theme (background + accent strip + content shape),
 *    icon tile renders the actual selected PixelIcon, notifications tile
 *    pulls a fresh unread count via `recompute()` on mount, fps tile
 *    shows live FPS, mode tile shows current dark/light mode, perf
 *    tile reflects the perf-monitor toggle.
 *
 * Apple compliance:
 *  - Top fixed at `insets.top + 6`. Never draws above the safe-area inset.
 *  - We do NOT render INSIDE the Dynamic Island region itself.
 *  - No new permissions, no new native modules, OTA-safe.
 *
 * Performance:
 *  - All transitions on the UI thread via Reanimated worklets.
 *  - One BlurView per surface (the card itself + 6 tile surfaces). All
 *    iOS material tints are stock chrome materials so the system
 *    composites them efficiently. No nested or stacked BlurViews — the
 *    earlier "lens BlurView on top of card BlurView" pattern was the
 *    expensive one and was removed previously.
 *  - The FPS tile only subscribes to `perfMonitor` when it's enabled in
 *    settings; otherwise shows a "—" placeholder.
 *  - Auto-dismiss is a single setTimeout cleared eagerly on interaction.
 */

import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text as RNText,
  useWindowDimensions,
  View,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../../theme';
import { useT } from '../../i18n/store';
import { GlassSurface, useLiquidGlassActive } from '../ui/LiquidGlass';
import { useAuthStore } from '../../store/authStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useNotificationsBadge } from '../../store/notificationsBadgeStore';
import { useDynamicOverlayStore } from '../../store/dynamicOverlayStore';
import { useThemeStore, ACCENT_COLORS } from '../../store/themeStore';
import { perfMonitor } from '../../services/perfMonitor';
import { kvGetJSONSync } from '../../services/kvStore';
import { CachedImage } from '../ui/CachedImage';
import { PixelIcon } from '../pixel-icons/PixelIcon';
import { triggerHaptic } from '../../utils/haptics';

// ─── Geometry constants ─────────────────────────────────────────────────────

const COLLAPSED_HEIGHT = 36;
const COLLAPSED_MAX_WIDTH = 290;
const SIDE_MARGIN = 16;
// Pill sits a touch lower below the notch so the row contents don't read
// as crammed against the system camera island. iPhones with a Dynamic
// Island already have ~6 pt of breathing room from the safe-area inset;
// 12 pt makes the floating pill feel intentionally separate from the
// system surface.
const TOP_GAP_BELOW_NOTCH = 12;
const COLLAPSED_RADIUS = 20;
const EXPANDED_RADIUS = 24;

const AUTO_DISMISS_MS = 6000;
const DISMISS_FADE_MS = 220;

// Tightened from (15, 200, 1.0). The previous low-damped spring had a
// visible overshoot on collapse that combined with the scale kick to
// LOOK like the card was re-expanding mid-shrink. Bumping damping to
// 22 keeps the spring critically-damped so collapse reads as a single
// smooth motion. Expand still feels elastic via the SCALE_KICK below.
const SPRING = { damping: 22, stiffness: 220, mass: 0.95 };

// Brief overshoot scale applied during EXPAND only — the surface
// stretches ~3 % past its target then settles. Suppressed on collapse
// because the spring's natural overshoot already provides the
// rubber-band feel; an extra kick on top creates a visible "pop back
// to full size" mid-collapse that the user reported as an artifact.
const SCALE_KICK_EXPAND = 1.03;

// ─── Glass material — single BlurView per surface, no stacking ─────────────

function GlassBackdrop({ isDark, radius }: { isDark: boolean; radius: number }) {
  // Native iOS-26 liquid glass when the user enabled it; otherwise the
  // existing BlurView (iOS) / gradient (Android) fallback — byte-identical to
  // the previous behaviour so nothing changes when glass is off.
  const iosFallback = (
    <BlurView
      intensity={isDark ? 70 : 80}
      tint={isDark ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight'}
      style={[StyleSheet.absoluteFill, { borderRadius: radius }]}
    />
  );
  const androidFallback = (
    <LinearGradient
      colors={
        isDark
          ? ['rgba(20,20,25,0.78)', 'rgba(30,30,35,0.88)']
          : ['rgba(255,255,255,0.7)', 'rgba(255,255,255,0.82)']
      }
      style={[StyleSheet.absoluteFill, { borderRadius: radius }]}
    />
  );
  return (
    <GlassSurface
      style={[StyleSheet.absoluteFill, { borderRadius: radius }]}
      glassStyle="regular"
      colorScheme={isDark ? 'dark' : 'light'}
      fallback={Platform.OS === 'ios' ? iosFallback : androidFallback}
    />
  );
}

function TopReflection({ isDark, radius }: { isDark: boolean; radius: number }) {
  return (
    <LinearGradient
      colors={
        isDark
          ? ['rgba(255,255,255,0.16)', 'rgba(255,255,255,0)']
          : ['rgba(255,255,255,0.55)', 'rgba(255,255,255,0)']
      }
      style={[
        styles.reflection,
        { borderTopLeftRadius: radius, borderTopRightRadius: radius },
      ]}
      pointerEvents="none"
    />
  );
}

// ─── Theme tile preview — stylish mini-mockup of the active theme ──────────
//
// Replaces the boring "single accent dot + label" preview. Renders a
// simulated app surface so the user actually sees what their theme looks
// like — accent-tinted top stripe, two short content lines, and a small
// accent action chip. Same idea as `ThemePreviewCard` in
// `app/settings/appearance.tsx` but stripped down to fit a 4×4 tile.

function ThemeTilePreview({
  accent,
  isDark,
  themeName,
}: {
  accent: string;
  isDark: boolean;
  themeName: string;
}) {
  const cardBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
  const lineColor = isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.18)';
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: 70,
          height: 50,
          borderRadius: 9,
          overflow: 'hidden',
          backgroundColor: cardBg,
          borderWidth: 0.5,
          borderColor: accent + '40',
        }}
      >
        {/* Accent top stripe — reads as a header / top bar in the mockup. */}
        <View style={{ height: 8, backgroundColor: accent }} />
        {/* Two content lines + a small action chip. */}
        <View style={{ paddingHorizontal: 6, paddingTop: 6, gap: 3 }}>
          <View style={{ height: 3, width: '70%', borderRadius: 1.5, backgroundColor: lineColor }} />
          <View style={{ height: 3, width: '50%', borderRadius: 1.5, backgroundColor: lineColor }} />
          <View
            style={{
              alignSelf: 'flex-end',
              marginTop: 4,
              width: 18,
              height: 6,
              borderRadius: 3,
              backgroundColor: accent,
            }}
          />
        </View>
      </View>
      <RNText
        numberOfLines={1}
        style={[styles.tilePreviewText, { color: isDark ? '#FFFFFF' : '#1A1A1A', marginTop: 4 }]}
      >
        {themeName}
      </RNText>
    </View>
  );
}

// ─── Generic tile ───────────────────────────────────────────────────────────

function DashboardTile({
  preview,
  label,
  onPress,
  isDark,
  borderColor,
}: {
  preview: React.ReactNode;
  label: string;
  onPress: () => void;
  isDark: boolean;
  borderColor: string;
}) {
  return (
    <Pressable onPress={onPress} style={styles.tile}>
      <View style={[StyleSheet.absoluteFill, { borderRadius: 16, overflow: 'hidden' }]}>
        <GlassSurface
          style={StyleSheet.absoluteFill}
          glassStyle="regular"
          colorScheme={isDark ? 'dark' : 'light'}
          fallback={
            Platform.OS === 'ios' ? (
              <BlurView
                intensity={isDark ? 40 : 60}
                tint={isDark ? 'systemThinMaterialDark' : 'systemThinMaterialLight'}
                style={StyleSheet.absoluteFill}
              />
            ) : (
              <View
                style={[
                  StyleSheet.absoluteFill,
                  {
                    backgroundColor: isDark
                      ? 'rgba(255,255,255,0.06)'
                      : 'rgba(255,255,255,0.45)',
                  },
                ]}
              />
            )
          }
        />
        <View
          style={[
            StyleSheet.absoluteFillObject,
            {
              borderRadius: 16,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor,
            },
          ]}
        />
      </View>

      <View style={styles.tileInner}>
        <View style={styles.tilePreviewWrap}>{preview}</View>
        <RNText
          numberOfLines={1}
          style={[styles.tileLabel, { color: isDark ? 'rgba(255,255,255,0.78)' : 'rgba(20,20,20,0.72)' }]}
        >
          {label}
        </RNText>
      </View>
    </Pressable>
  );
}

// ─── Main host ──────────────────────────────────────────────────────────────

function DynamicOverlayHostInner() {
  const insets = useSafeAreaInsets();
  const { width: screenW, height: screenH } = useWindowDimensions();
  const theme = useTheme();
  const isDark = theme.isDark;
  const t = useT();
  // Real native glass active? Drop the painted top-reflection gradient over it
  // (it dulls the genuine specular highlight), exactly like the tab bar.
  const glassActive = useLiquidGlassActive();

  const visible = useDynamicOverlayStore((s) => s.visible);
  const expanded = useDynamicOverlayStore((s) => s.expanded);
  const toggleExpand = useDynamicOverlayStore((s) => s.toggleExpand);
  const hide = useDynamicOverlayStore((s) => s.hide);

  const userEmoji = useAuthStore((s) => s.user?.emoji);
  const userAvatar = useAuthStore((s) => s.user?.avatar);
  const userDisplayName = useAuthStore((s) => s.user?.displayName);
  const homeHeaderIcon = useSettingsStore((s) => s.homeHeaderIcon);
  const unread = useNotificationsBadge((s) => s.unread);
  const recomputeBadge = useNotificationsBadge((s) => s.recompute);
  const accentKey = useThemeStore((s) => s.accent);
  const aiThemes = useThemeStore((s) => s.aiThemes);

  const accent = theme.colors.accent.primary;

  // Recompute the unread count whenever the overlay becomes visible. The
  // store doesn't auto-refresh — the home-feed bell calls `recompute()` on
  // focus and we need the same trigger here, otherwise the tile shows a
  // stale "0" until something else nudges the badge.
  useEffect(() => {
    if (visible) {
      try { recomputeBadge(); } catch {}
    }
  }, [visible, recomputeBadge]);

  // Read TOTAL notifications count from the cache, not just unread. The
  // unread count drops to 0 the moment the user visits /notifications
  // (markAllSeen fires on screen mount), which made the tile look broken
  // when the user had a non-empty notifications list. Showing the total
  // count + unread badge gives the right "I have N notifications" cue.
  // Re-reads each time the overlay opens — cache is sync MMKV so the
  // cost is negligible.
  const notifTotal = useMemo(() => {
    if (!visible) return 0;
    try {
      const c = kvGetJSONSync<{ data: Array<unknown> } | null>('@san:notifications', null);
      return Array.isArray(c?.data) ? c!.data.length : 0;
    } catch {
      return 0;
    }
  }, [visible]);

  const themeName = useMemo(() => {
    const builtin = ACCENT_COLORS.find((c) => c.key === accentKey);
    if (builtin) return builtin.label;
    const ai = aiThemes.find((c) => c.key === accentKey);
    if (ai) return ai.label;
    return accent;
  }, [accentKey, aiThemes, accent]);

  const shortName = useMemo(() => {
    const name = userDisplayName || '';
    if (!name) return '';
    return name.length > 6 ? name.slice(0, 6) + '…' : name;
  }, [userDisplayName]);

  // ─── Reanimated state ───────────────────────────────────────────────
  const progress = useSharedValue(0);
  const appearance = useSharedValue(0);
  // Liquid-stretch scale kick. Sequenced separately from `progress` so the
  // overshoot reads as a brief "rubber band" tug at the start of an
  // expand/collapse, not an oscillation around the entire morph timeline.
  const scaleKick = useSharedValue(1);
  // Drag-driven X/Y translation + stretch — drives a "rubber band" feel
  // when the user pans the pill itself. Mirrors the bottom-tab-bar
  // sliding-pill physics: pill follows the finger 1:1 (clamped),
  // stretches slightly with motion, then springs back to centre on
  // release. Drives transform.translate{X,Y} + a scaleX/scaleY kick.
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  const dragStretch = useSharedValue(0);
  const dismissingRef = useRef(false);

  useEffect(() => {
    if (visible) {
      dismissingRef.current = false;
      // Reset every transient shared value to its neutral state. Without
      // this the pill could "ghost" — if the user dragged it left and the
      // auto-dismiss timer fired before they released, the next show()
      // would render the pill at its last drag offset rather than the
      // centred slot. The host doesn't unmount on hide (we early-return
      // null AFTER hooks), so shared-values persist across visibility
      // toggles unless we explicitly reset them here.
      scaleKick.value = 1;
      dragX.value = 0;
      dragY.value = 0;
      dragStretch.value = 0;
      appearance.value = withTiming(1, {
        duration: DISMISS_FADE_MS,
        easing: Easing.out(Easing.cubic),
      });
    }
  }, [visible, appearance, scaleKick, dragX, dragY, dragStretch]);

  // Re-fire the scale kick on EXPAND ONLY. On collapse the spring's
  // natural overshoot is enough — adding a separate kick made the card
  // visibly "pop back to full size" mid-collapse (the artifact users
  // reported when tapping the chevron-down).
  useEffect(() => {
    progress.value = withSpring(expanded ? 1 : 0, SPRING);
    if (dismissingRef.current) return;
    if (!expanded) {
      // Snap any stale kick back to neutral immediately. Spring-toward-1
      // would visibly overshoot DURING the collapse spring, which is the
      // exact double-bounce we're trying to remove.
      scaleKick.value = 1;
      return;
    }
    scaleKick.value = withTiming(SCALE_KICK_EXPAND, { duration: 120, easing: Easing.out(Easing.cubic) }, () => {
      scaleKick.value = withSpring(1, { damping: 14, stiffness: 220 });
    });
  }, [expanded, progress, scaleKick]);

  // ─── Dismiss flow ───────────────────────────────────────────────────
  // Two-stage:
  //   1. Collapse the morph back to pill (spring).
  //   2. After ~120 ms, fade up + fade out (timing).
  //
  // Optional `afterDismiss` runs only AFTER stage 2 completes — used by
  // tile-tap navigations so the destination route doesn't render
  // through the half-faded overlay.
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearDismissTimer = useCallback(() => {
    if (dismissTimerRef.current != null) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
  }, []);

  // Track whether we're in the middle of a dismiss animation. The
  // expanded-state effect that fires the `scaleKick` overshoot reads
  // this — if true, the kick is suppressed so the dismiss reads as a
  // single fluid exit rather than bounce-into-fade.
  const onDismissJS = useCallback(() => {
    hide();
  }, [hide]);

  const startDismiss = useCallback(
    (afterDismiss?: () => void) => {
      if (dismissingRef.current) return;
      dismissingRef.current = true;
      try { triggerHaptic('selection'); } catch {}
      clearDismissTimer();
      // Stage 1: spring back to collapsed (no scaleKick — the kick is
      // suppressed when `dismissingRef` is true; see the expanded effect
      // above).
      progress.value = withSpring(0, SPRING);
      // Stage 2: a beat later, fade up + out. The 180 ms overlap with the
      // collapse spring makes it read as a single fluid exit rather than
      // two stages.
      appearance.value = withTiming(
        0,
        { duration: DISMISS_FADE_MS, easing: Easing.in(Easing.cubic) },
        (finished) => {
          if (finished) {
            runOnJS(onDismissJS)();
            if (afterDismiss) runOnJS(afterDismiss)();
          }
        },
      );
      // Don't call collapse() — that re-fires the expanded effect which
      // would queue another scaleKick on top of our exit. The visible
      // morph is already driven by `progress` directly above.
    },
    [progress, appearance, onDismissJS, clearDismissTimer],
  );

  // ─── Layout interpolation ───────────────────────────────────────────
  const collapsedWidth = Math.min(screenW - 2 * SIDE_MARGIN, COLLAPSED_MAX_WIDTH);
  const collapsedLeft = (screenW - collapsedWidth) / 2;
  const expandedWidth = screenW - 2 * SIDE_MARGIN;
  // ~22 % of screen height — fits a single row of three tiles tightly.
  // Earlier the grid was 3 × 2 with Mode / Monitor / FPS in the second
  // row, but the user explicitly asked to remove those, so we collapse
  // back to a single row of "Theme · Icon · Notifications".
  const expandedHeight = Math.round(screenH * 0.22);

  const containerStyle = useAnimatedStyle(() => ({
    width: interpolate(progress.value, [0, 1], [collapsedWidth, expandedWidth]),
    height: interpolate(progress.value, [0, 1], [COLLAPSED_HEIGHT, expandedHeight]),
    left: interpolate(progress.value, [0, 1], [collapsedLeft, SIDE_MARGIN]),
    borderRadius: interpolate(
      progress.value,
      [0, 1],
      [COLLAPSED_RADIUS, EXPANDED_RADIUS],
    ),
    opacity: appearance.value,
    transform: [
      // Combined translate: appearance lift on entry/exit + drag offset
      // when the user is panning the pill. The drag is clamped so the
      // pill never wanders off-screen — feels like the pill is anchored
      // to its slot but can be tugged in any direction with a rubber band.
      { translateX: dragX.value },
      { translateY: interpolate(appearance.value, [0, 1], [-12, 0]) + dragY.value },
      // Liquid-stretch overshoot on tap-expand.
      { scale: scaleKick.value },
      // Drag-stretch — even smoother than v2. The direct dragX / dragY
      // contributions to the scale axes were halved AGAIN (0.0004 →
      // 0.0002 / 0.0002 → 0.0001), so the pill's stretch builds almost
      // entirely from `dragStretch` (which itself ramps gradually over
      // 110 px of motion). Net effect: barely any visible deformation
      // for short drags, gentle bulge for long ones.
      { scaleX: 1 + Math.abs(dragX.value) * 0.0002 + dragStretch.value },
      { scaleY: 1 - Math.abs(dragX.value) * 0.0001 - dragStretch.value * 0.4 },
    ],
  }));

  // ─── Pan gesture for the rubber-band drag ────────────────────────────
  // Same physics shape as `CustomTabBar`'s sliding-pill drag — pan moves
  // the pill 1:1 within bounds, stretches it slightly with motion, springs
  // back to centre on release. All on the UI thread.
  //
  // Tuning round 3 per user feedback: previous version still felt too
  // snappy when releasing. Softer release spring (lower stiffness, more
  // damping, more mass) gives a slow ease-back. Tighter caps so even
  // big drags don't yank the pill far enough to feel jumpy.
  const PAN_TRANSLATE_X_MAX = 24;
  const PAN_TRANSLATE_Y_MAX = 18;
  const STRETCH_MAX = 0.025;
  const DRAG_RELEASE_SPRING = { damping: 22, stiffness: 110, mass: 1.3 };
  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(4)
        .onUpdate((e) => {
          'worklet';
          dragX.value = Math.max(-PAN_TRANSLATE_X_MAX, Math.min(PAN_TRANSLATE_X_MAX, e.translationX * 0.85));
          dragY.value = Math.max(-PAN_TRANSLATE_Y_MAX, Math.min(PAN_TRANSLATE_Y_MAX, e.translationY * 0.85));
          // Stretch builds with finger distance, normalised over a longer
          // distance (110 px → 0..1) so initial drag has barely any
          // visible deformation. Smoother ramp-in than the previous
          // 90 px normalisation.
          const mag = Math.min(1, Math.sqrt(e.translationX ** 2 + e.translationY ** 2) / 110);
          dragStretch.value = mag * STRETCH_MAX;
        })
        .onFinalize(() => {
          'worklet';
          dragX.value = withSpring(0, DRAG_RELEASE_SPRING);
          dragY.value = withSpring(0, DRAG_RELEASE_SPRING);
          dragStretch.value = withSpring(0, DRAG_RELEASE_SPRING);
        }),
    // shared-values are stable refs; gesture is cheap to keep around.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const bodyStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0.4, 1], [0, 1], Extrapolation.CLAMP),
    transform: [
      { translateY: interpolate(progress.value, [0, 1], [-8, 0], Extrapolation.CLAMP) },
    ],
  }));

  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${interpolate(progress.value, [0, 1], [0, 180])}deg` }],
  }));

  // Pill row content drops 8 px downward inside the card when the
  // overlay is expanded. Collapsed-state geometry stays untouched
  // (avatar/name/dot/icon/chevron/X are vertically centred in the
  // 36 px pill row). When expanded, 8 px of paddingTop pushes the same
  // row content lower so it doesn't read as "stuck against the top
  // edge" of the bigger card. Driven on the UI thread via the same
  // `progress` shared value the morph already uses, so there's no
  // extra render trigger.
  const pillRowStyle = useAnimatedStyle(() => ({
    paddingTop: interpolate(progress.value, [0, 1], [0, 8]),
    height: interpolate(progress.value, [0, 1], [COLLAPSED_HEIGHT, COLLAPSED_HEIGHT + 8]),
  }));

  // The expanded-state tap-out region only catches when expanded — pointer
  // events flip on/off via the `expanded` flag. When collapsed, no
  // catchment exists and every touch outside the small pill passes
  // through to the underlying screen.
  const dismissOverlayStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [0, 1], Extrapolation.CLAMP),
  }));

  // ─── Auto-dismiss (collapsed only) ──────────────────────────────────
  useEffect(() => {
    clearDismissTimer();
    if (visible && !expanded) {
      dismissTimerRef.current = setTimeout(() => {
        startDismiss();
      }, AUTO_DISMISS_MS);
    }
    return clearDismissTimer;
  }, [visible, expanded, startDismiss, clearDismissTimer]);

  // ─── Interaction handlers ────────────────────────────────────────────
  const onChevron = useCallback(() => {
    clearDismissTimer();
    try { triggerHaptic('selection'); } catch {}
    toggleExpand();
  }, [toggleExpand, clearDismissTimer]);

  const goTheme = useCallback(() => {
    startDismiss(() => router.push('/settings/appearance'));
  }, [startDismiss]);

  const goIcon = useCallback(() => {
    startDismiss(() => router.push('/settings/pixel-icons?purpose=home-header'));
  }, [startDismiss]);

  const goNotifications = useCallback(() => {
    startDismiss(() => router.push('/notifications'));
  }, [startDismiss]);

  const onTapOutside = useCallback(() => {
    startDismiss();
  }, [startDismiss]);

  if (!visible) return null;

  const tileBorder = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.55)';

  return (
    // Root is `pointerEvents="box-none"` so when collapsed every touch
    // outside the pill passes through to whatever screen is mounted
    // underneath. The expanded-state dismiss region opts back into hit
    // testing only while expanded.
    <View style={styles.root} pointerEvents="box-none">
      {/* Tap-outside dismiss region — covers the screen below the safe
          area top, but is COMPLETELY TRANSPARENT (no scrim, no dim) so
          the underlying UI stays visible at full opacity. Active only
          when expanded. */}
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          { top: insets.top },
          dismissOverlayStyle,
        ]}
        pointerEvents={expanded ? 'auto' : 'none'}
      >
        <Pressable onPress={onTapOutside} style={StyleSheet.absoluteFill} />
      </Animated.View>

      {/* The pill / card itself. Top fixed at insets.top + 6 — never
          extends above the safe-area inset (Apple compliance). Wrapped
          in a Pan gesture so the user can drag the pill / card around
          for a brief rubber-band stretch — same physics as the bottom
          tab-bar's sliding pill. Releases spring back to centre. */}
      <GestureDetector gesture={panGesture}>
        <Animated.View
          style={[
            styles.container,
            {
              top: insets.top + TOP_GAP_BELOW_NOTCH,
              shadowColor: isDark ? '#000' : 'rgba(0,0,0,0.25)',
              borderColor: isDark ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.65)',
            },
            containerStyle,
          ]}
        >
        <GlassBackdrop isDark={isDark} radius={EXPANDED_RADIUS} />
        {!glassActive && <TopReflection isDark={isDark} radius={EXPANDED_RADIUS} />}

        {/* Pill content row */}
        <Animated.View style={[styles.pillRow, pillRowStyle]}>
          <View style={styles.avatar}>
            {userAvatar ? (
              <CachedImage
                uri={userAvatar}
                style={{ width: 22, height: 22, borderRadius: 11 }}
                proxyWidth={22}
              />
            ) : (
              <RNText style={styles.avatarEmoji} allowFontScaling={false}>
                {userEmoji || '🙂'}
              </RNText>
            )}
          </View>

          {!!shortName && (
            <RNText
              numberOfLines={1}
              style={[styles.name, { color: isDark ? '#FFFFFF' : '#1A1A1A' }]}
            >
              {shortName}
            </RNText>
          )}

          <View style={[styles.themeDot, { backgroundColor: accent }]} />

          {homeHeaderIcon ? (
            <View style={styles.pixelWrap}>
              <PixelIcon id={homeHeaderIcon} size={18} />
            </View>
          ) : null}

          <View style={{ flex: 1 }} />

          <Pressable onPress={onChevron} hitSlop={8} style={styles.chevron}>
            <Animated.View style={chevronStyle}>
              <Feather
                name="chevron-down"
                size={18}
                color={isDark ? '#FFFFFF' : '#1A1A1A'}
              />
            </Animated.View>
          </Pressable>
          <Pressable
            onPress={() => startDismiss()}
            hitSlop={8}
            style={styles.chevron}
            accessibilityRole="button"
            accessibilityLabel={t('common.close', 'Close')}
          >
            <Feather
              name="x"
              size={16}
              color={isDark ? 'rgba(255,255,255,0.7)' : 'rgba(20,20,20,0.6)'}
            />
          </Pressable>
        </Animated.View>

        {/* Expanded card body */}
        <Animated.View
          style={[styles.body, bodyStyle]}
          pointerEvents={expanded ? 'auto' : 'none'}
        >
          <View style={styles.tilesGrid}>
            {/* Single row of three tiles — Theme · Icon · Notifications.
                Mode / Monitor / FPS were removed per user feedback: they
                duplicate functionality already reachable from the perf
                bubble or settings, and made the widget feel half-empty. */}
            <DashboardTile
              preview={<ThemeTilePreview accent={accent} isDark={isDark} themeName={themeName} />}
              label={t('dynamic_overlay.theme', 'Theme')}
              onPress={goTheme}
              isDark={isDark}
              borderColor={tileBorder}
            />

            <DashboardTile
              preview={
                homeHeaderIcon ? (
                  <PixelIcon id={homeHeaderIcon} size={44} />
                ) : (
                  <View style={{ alignItems: 'center', justifyContent: 'center' }}>
                    <Feather
                      name="image"
                      size={28}
                      color={isDark ? 'rgba(255,255,255,0.4)' : 'rgba(20,20,20,0.35)'}
                    />
                  </View>
                )
              }
              label={t('dynamic_overlay.icon', 'Icon')}
              onPress={goIcon}
              isDark={isDark}
              borderColor={tileBorder}
            />

            <DashboardTile
              preview={
                <View style={{ alignItems: 'center', justifyContent: 'center' }}>
                  <View style={{ position: 'relative' }}>
                    <Feather name="bell" size={26} color={accent} style={{ marginBottom: 4 }} />
                    {/* Tiny accent badge in the upper-right of the bell when
                        the user has anything UNSEEN. Scales the visual cue
                        so a 0-unread state still shows the total count. */}
                    {unread > 0 ? (
                      <View
                        style={{
                          position: 'absolute',
                          top: -2,
                          right: -4,
                          width: 8,
                          height: 8,
                          borderRadius: 4,
                          backgroundColor: '#ef4444',
                          borderWidth: 1.5,
                          borderColor: isDark ? '#000' : '#fff',
                        }}
                      />
                    ) : null}
                  </View>
                  <RNText style={[styles.tileNumberValue, { color: isDark ? '#FFFFFF' : '#1A1A1A' }]}>
                    {notifTotal > 99 ? '99+' : String(notifTotal)}
                  </RNText>
                </View>
              }
              label={t('dynamic_overlay.notifications', 'Notifications')}
              onPress={goNotifications}
              isDark={isDark}
              borderColor={tileBorder}
            />
          </View>
        </Animated.View>

        {/* Hairline border drawn last so it sits above blur + reflection. */}
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFillObject,
            {
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: isDark ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.7)',
              borderRadius: EXPANDED_RADIUS,
            },
          ]}
        />
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

export const DynamicOverlayHost = memo(DynamicOverlayHostInner);

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9998,
  },
  container: {
    position: 'absolute',
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 18,
    elevation: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  reflection: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '46%',
  },
  pillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: COLLAPSED_HEIGHT,
    paddingHorizontal: 10,
    gap: 8,
    zIndex: 2,
  },
  avatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarEmoji: {
    fontSize: 14,
    lineHeight: 18,
    includeFontPadding: false,
    textAlign: 'center',
  },
  name: { fontSize: 13, fontWeight: '600', maxWidth: 90 },
  themeDot: { width: 8, height: 8, borderRadius: 4 },
  pixelWrap: { width: 18, height: 18, alignItems: 'center', justifyContent: 'center' },
  chevron: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
  body: {
    flex: 1,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 14,
    zIndex: 1,
  },
  tilesGrid: {
    flex: 1,
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  tile: {
    flex: 1,
    aspectRatio: 0.95,
    borderRadius: 16,
    overflow: 'hidden',
  },
  tileInner: {
    flex: 1,
    paddingHorizontal: 8,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tilePreviewWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tilePreviewText: {
    fontSize: 11,
    fontWeight: '600',
    maxWidth: 86,
    textAlign: 'center',
  },
  tileLabel: {
    fontSize: 10,
    fontWeight: '500',
    letterSpacing: 0.3,
    marginTop: 2,
    textTransform: 'uppercase',
  },
  tileNumberValue: {
    fontSize: 18,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
});

export default DynamicOverlayHost;
