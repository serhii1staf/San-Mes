/**
 * DynamicOverlayHost — the actual mounted overlay (collapsed pill +
 * expanded half-screen card) for the Dynamic Island companion feature.
 *
 * Two visual states driven by a single shared value (`progress`, 0 → 1):
 *
 *   - Collapsed (progress = 0): ~290 × 36 pill centred horizontally just
 *     below the notch. Shows avatar / display name / theme dot / pixel
 *     icon thumb / chevron-down.
 *   - Expanded  (progress = 1): full-width-minus-margins card, half the
 *     screen height. Same pill content row at the top, then a 2 × 2
 *     dashboard of glass tiles (theme · pixel-icon · notifications · fps).
 *
 * The whole component only mounts when the store flips `visible = true`,
 * so when dismissed there's literally nothing on the tree — zero idle
 * cost. Long-press the Home tab in the bottom bar to summon it (see
 * `app/(tabs)/_layout.tsx` `homeListeners`).
 *
 * Critical UX rules (user-driven):
 *  - The overlay NEVER dims or blocks the rest of the UI. Only the pill /
 *    card itself catches touches; everything outside is fully interactive.
 *    No backdrop scrim, no blocked taps anywhere on screen.
 *  - When dismissed, the overlay first morphs back to the collapsed pill
 *    (if it was expanded), then floats UP and fades out — never a hard
 *    cut. This is the inverse of how it appeared.
 *  - Tile contents show real previews — the icon tile renders the actual
 *    selected PixelIcon, the theme tile shows the live accent color and
 *    theme name, etc. Not generic "Edit" labels.
 *
 * Apple compliance:
 *  - We position strictly within `insets.top + 6` and below. The notch and
 *    the system clock / battery icons stay visible at all times.
 *  - We do NOT render INSIDE the Dynamic Island region itself.
 *  - No new permissions, no new native modules, OTA-safe.
 *
 * Performance:
 *  - All state transitions live on the UI thread via Reanimated.
 *  - The FPS tile only subscribes to `perfMonitor` when the perf monitor
 *    is enabled in settings; otherwise it shows a "—" placeholder.
 *  - Auto-dismiss is a single setTimeout in the collapsed state, cleared
 *    eagerly on every interaction.
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
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../../theme';
import { useT } from '../../i18n/store';
import { useAuthStore } from '../../store/authStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useNotificationsBadge } from '../../store/notificationsBadgeStore';
import { useDynamicOverlayStore } from '../../store/dynamicOverlayStore';
import { useThemeStore, ACCENT_COLORS } from '../../store/themeStore';
import { perfMonitor } from '../../services/perfMonitor';
import { CachedImage } from '../ui/CachedImage';
import { PixelIcon } from '../pixel-icons/PixelIcon';
import { triggerHaptic } from '../../utils/haptics';

// ─── Geometry constants ─────────────────────────────────────────────────────

const COLLAPSED_HEIGHT = 36;
const COLLAPSED_MAX_WIDTH = 290;
const SIDE_MARGIN = 16;
const TOP_GAP_BELOW_NOTCH = 6;
const COLLAPSED_RADIUS = 20;
const EXPANDED_RADIUS = 24;

// 6 seconds of inactivity in collapsed state auto-dismisses the overlay so
// it doesn't linger if the user opens it then forgets. Cleared eagerly on
// any interaction (chevron tap, etc.).
const AUTO_DISMISS_MS = 6000;

const SPRING = { damping: 22, stiffness: 240, mass: 0.9 };

// Dismiss animation — first collapse if expanded (~280 ms spring), then
// float up 24 px and fade to 0 (220 ms timing). Total ≈ 500 ms in the
// worst case, ≈ 220 ms when already collapsed. Inverse of the appearance.
const DISMISS_FADE_MS = 220;

// ─── Glass material ─────────────────────────────────────────────────────────

function GlassBackdrop({ isDark, radius }: { isDark: boolean; radius: number }) {
  if (Platform.OS === 'ios') {
    return (
      <BlurView
        intensity={isDark ? 70 : 80}
        tint={isDark ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight'}
        style={[StyleSheet.absoluteFill, { borderRadius: radius }]}
      />
    );
  }
  return (
    <LinearGradient
      colors={
        isDark
          ? ['rgba(20,20,25,0.78)', 'rgba(30,30,35,0.88)']
          : ['rgba(255,255,255,0.7)', 'rgba(255,255,255,0.82)']
      }
      style={[StyleSheet.absoluteFill, { borderRadius: radius }]}
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

// ─── Tile (used by the 2×2 dashboard inside the expanded card) ──────────────
//
// Tiles render REAL previews of the value they represent — the icon tile
// shows the actual selected PixelIcon, the theme tile shows the live
// accent color, etc. This is the user-visible payoff for the overlay,
// so we lean into it: previews are big (44+ px), labels small underneath.

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
      <View style={[StyleSheet.absoluteFill, { borderRadius: 18, overflow: 'hidden' }]}>
        {Platform.OS === 'ios' ? (
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
        )}
        <View
          style={[
            StyleSheet.absoluteFillObject,
            {
              borderRadius: 18,
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

// ─── FPS tile preview — only subscribes when perf monitor is on ─────────────

function FpsTilePreview({ accent, isDark }: { accent: string; isDark: boolean }) {
  const enabled = useSettingsStore((s) => s.perfMonitorEnabled);
  const [fps, setFps] = useState<number | null>(() =>
    enabled ? perfMonitor.snapshot().jsFps || null : null,
  );

  useEffect(() => {
    if (!enabled) {
      setFps(null);
      return;
    }
    let last = 0;
    const unsub = perfMonitor.subscribe((s) => {
      const now = Date.now();
      if (now - last < 480) return;
      last = now;
      setFps(s.jsFps || 0);
    });
    return unsub;
  }, [enabled]);

  // Color the number by health: green ≥ 50, amber 30-49, red < 30.
  const color =
    fps == null
      ? isDark
        ? 'rgba(255,255,255,0.5)'
        : 'rgba(20,20,20,0.5)'
      : fps >= 50
      ? '#22c55e'
      : fps >= 30
      ? '#f59e0b'
      : '#ef4444';

  return (
    <View style={{ alignItems: 'center', justifyContent: 'center' }}>
      <Feather name="activity" size={20} color={accent} style={{ marginBottom: 4 }} />
      <RNText style={[styles.tileNumberValue, { color }]}>
        {fps == null ? '—' : String(fps)}
      </RNText>
    </View>
  );
}

// ─── Main host ──────────────────────────────────────────────────────────────

function DynamicOverlayHostInner() {
  const insets = useSafeAreaInsets();
  const { width: screenW, height: screenH } = useWindowDimensions();
  const theme = useTheme();
  const isDark = theme.isDark;
  const t = useT();

  const visible = useDynamicOverlayStore((s) => s.visible);
  const expanded = useDynamicOverlayStore((s) => s.expanded);
  const toggleExpand = useDynamicOverlayStore((s) => s.toggleExpand);
  const hide = useDynamicOverlayStore((s) => s.hide);
  const collapse = useDynamicOverlayStore((s) => s.collapse);

  // Subscribe with field selectors so unrelated profile / icon changes don't
  // re-render the host tree on every keystroke elsewhere.
  const userEmoji = useAuthStore((s) => s.user?.emoji);
  const userAvatar = useAuthStore((s) => s.user?.avatar);
  const userDisplayName = useAuthStore((s) => s.user?.displayName);
  const homeHeaderIcon = useSettingsStore((s) => s.homeHeaderIcon);
  const unread = useNotificationsBadge((s) => s.unread);
  const accentKey = useThemeStore((s) => s.accent);
  const aiThemes = useThemeStore((s) => s.aiThemes);

  const accent = theme.colors.accent.primary;

  // Resolve the active theme's display name for the theme tile preview.
  // Falls back to the accent color hex when the key doesn't match anything.
  const themeName = useMemo(() => {
    const builtin = ACCENT_COLORS.find((c) => c.key === accentKey);
    if (builtin) return builtin.label;
    const ai = aiThemes.find((c) => c.key === accentKey);
    if (ai) return ai.label;
    return accent;
  }, [accentKey, aiThemes, accent]);

  // Truncate long display names to "first 6 chars + …" so the pill stays
  // narrow. Memoised because the input rarely changes but we mount this
  // every time the overlay opens.
  const shortName = useMemo(() => {
    const name = userDisplayName || '';
    if (!name) return '';
    return name.length > 6 ? name.slice(0, 6) + '…' : name;
  }, [userDisplayName]);

  // ─── Reanimated progress + appearance ───────────────────────────────
  // Two shared values:
  //   - `progress` — 0 (collapsed pill) → 1 (expanded card), drives the
  //     morph between the two visual states.
  //   - `appearance` — 0 (hidden / faded out) → 1 (fully on screen), drives
  //     the entry/exit fade + lift. Inverse-on-dismiss so the overlay
  //     visibly retreats UP and fades, rather than hard-cutting.
  const progress = useSharedValue(0);
  const appearance = useSharedValue(0);

  // Track whether we're in the middle of a dismiss animation — guards the
  // `hide()` call so an in-flight collapse doesn't fire twice.
  const dismissingRef = useRef(false);

  useEffect(() => {
    if (visible) {
      dismissingRef.current = false;
      // Float in: appear from -10 px above and fade in over ~220 ms.
      appearance.value = withTiming(1, {
        duration: DISMISS_FADE_MS,
        easing: Easing.out(Easing.cubic),
      });
    }
  }, [visible, appearance]);

  useEffect(() => {
    progress.value = withSpring(expanded ? 1 : 0, SPRING);
  }, [expanded, progress]);

  // Smooth dismiss: collapse first if expanded (single spring tick), then
  // run a reverse fade-up. Touches both shared values on the UI thread; the
  // store flip happens via `runOnJS` in the timing callback so React tears
  // down the tree only after the visible animation has finished.
  const onDismissJS = useCallback(() => {
    hide();
  }, [hide]);

  const startDismiss = useCallback(() => {
    if (dismissingRef.current) return;
    dismissingRef.current = true;
    triggerHaptic('selection');
    // Stop auto-dismiss timer before animating out.
    if (dismissTimerRef.current != null) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
    // Always collapse the morph first so the lift-up reads clean.
    progress.value = withSpring(0, SPRING);
    // Schedule the fade-up after a short overlap with the collapse so the
    // two animations blend rather than queue. 180 ms feels like a single
    // continuous gesture rather than two stages.
    appearance.value = withTiming(
      0,
      { duration: DISMISS_FADE_MS, easing: Easing.in(Easing.cubic) },
      (finished) => {
        if (finished) runOnJS(onDismissJS)();
      },
    );
    // Local UI: reset expanded state in the store NOW so the body unmounts
    // its expensive children early; the visual collapse is driven by
    // `progress` shared value, not by mount/unmount.
    if (expanded) collapse();
  }, [progress, appearance, expanded, collapse, onDismissJS]);

  // Backdrop is non-interactive in BOTH states. It exists only as the tap
  // catchment that triggers dismiss when tapped outside the pill / card.
  // No fill, no scrim — the rest of the UI stays fully visible underneath.
  // (User-driven: "затемнения не должно быть. виджет никак не должен
  // влиять на интерфейс".)

  // Container animates width / height / left / radius simultaneously so
  // the morph reads as a single fluid expand rather than two disjoint
  // anim tracks. `appearance` adds the fade-in/out + 10 px float.
  const collapsedWidth = Math.min(screenW - 2 * SIDE_MARGIN, COLLAPSED_MAX_WIDTH);
  const collapsedLeft = (screenW - collapsedWidth) / 2;
  const expandedWidth = screenW - 2 * SIDE_MARGIN;
  const expandedHeight = Math.round(screenH * 0.5);

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
      { translateY: interpolate(appearance.value, [0, 1], [-12, 0]) },
    ],
  }));

  // Body of the expanded card fades in only after the morph is partway
  // through so it reads as "the pill GREW into a card" rather than
  // "two views crossfaded".
  const bodyStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0.4, 1], [0, 1], Extrapolation.CLAMP),
    transform: [
      {
        translateY: interpolate(
          progress.value,
          [0, 1],
          [-8, 0],
          Extrapolation.CLAMP,
        ),
      },
    ],
  }));

  // Chevron flips 180° when expanded so it points up — a well-understood
  // affordance for "tap me to collapse this".
  const chevronStyle = useAnimatedStyle(() => ({
    transform: [
      {
        rotate: `${interpolate(progress.value, [0, 1], [0, 180])}deg`,
      },
    ],
  }));

  // Auto-dismiss timer — only runs while in the collapsed state. Re-armed
  // whenever the overlay first becomes visible or collapses back from the
  // expanded card. Cleared eagerly on any interaction.
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearDismissTimer = useCallback(() => {
    if (dismissTimerRef.current != null) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
  }, []);
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
    triggerHaptic('selection');
    toggleExpand();
  }, [toggleExpand, clearDismissTimer]);

  const goTheme = useCallback(() => {
    clearDismissTimer();
    startDismiss();
    router.push('/settings/appearance');
  }, [startDismiss, clearDismissTimer]);

  const goIcon = useCallback(() => {
    clearDismissTimer();
    startDismiss();
    router.push('/settings/pixel-icons?purpose=home-header');
  }, [startDismiss, clearDismissTimer]);

  const goNotifications = useCallback(() => {
    clearDismissTimer();
    startDismiss();
    router.push('/notifications');
  }, [startDismiss, clearDismissTimer]);

  // Perf-monitor panel ownership lives in the bubble itself; from here the
  // closest accessible flow is the storage screen — flip the perf monitor
  // toggle there if the user wants to inspect deeper.
  const goPerf = useCallback(() => {
    clearDismissTimer();
    startDismiss();
    router.push('/settings/storage');
  }, [startDismiss, clearDismissTimer]);

  if (!visible) return null;

  // Tile-border colour, lifted out so both light + dark themes get a hairline
  // that's just visible against the glass background.
  const tileBorder = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.55)';

  return (
    // Root is `pointerEvents="box-none"` so taps inside the overlay's own
    // children (pill / card / dismiss-region) work, but everything OUTSIDE
    // those children passes straight through to whatever screen sits below.
    // The user can keep using the app — settings, scroll, taps, anything —
    // while the pill is up.
    <View style={styles.root} pointerEvents="box-none">
      {/* Invisible tap-catch region that ONLY exists inside the expanded
          card's footprint outside the card itself. When collapsed it covers
          ZERO screen real estate, so taps anywhere outside the pill go
          through. When expanded, taps that fall in the gap between the
          card edges and the screen edges dismiss the overlay. We achieve
          this by making the dismiss target the FULL screen but letting it
          bail out if the touch coordinates land inside the card.
          To keep this dead simple we use a small dismiss button sitting
          ABOVE the pill in collapsed state, and rely on the chevron itself
          for explicit close in either state. No screen-wide tap layer at
          all — that was the source of the "can't tap settings while
          overlay is open" bug. */}

      {/* The pill / card itself. Top is fixed at insets.top + 6 — never
          extends above the safe-area inset (Apple compliance). */}
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
        <TopReflection isDark={isDark} radius={EXPANDED_RADIUS} />

        {/* Pill content row — visible in both states. In expanded mode it
            sits at the top of the card. */}
        <View style={styles.pillRow}>
          {/* Avatar 22 × 22 — emoji-first since it doesn't need a network
              hop, falls back to the avatar URL via CachedImage. */}
          <View style={styles.avatar}>
            {userAvatar ? (
              <CachedImage
                uri={userAvatar}
                style={{ width: 22, height: 22, borderRadius: 11 }}
                proxyWidth={22}
              />
            ) : (
              <RNText
                style={styles.avatarEmoji}
                allowFontScaling={false}
              >
                {userEmoji || '🙂'}
              </RNText>
            )}
          </View>

          {/* Truncated display name */}
          {!!shortName && (
            <RNText
              numberOfLines={1}
              style={[
                styles.name,
                { color: isDark ? '#FFFFFF' : '#1A1A1A' },
              ]}
            >
              {shortName}
            </RNText>
          )}

          {/* Active theme color dot */}
          <View
            style={[styles.themeDot, { backgroundColor: accent }]}
            accessibilityElementsHidden
            importantForAccessibility="no"
          />

          {/* Active pixel-icon thumb (only when the user has one set) */}
          {homeHeaderIcon ? (
            <View style={styles.pixelWrap}>
              <PixelIcon id={homeHeaderIcon} size={18} />
            </View>
          ) : null}

          <View style={{ flex: 1 }} />

          {/* Two-button trailing region: chevron expands/collapses, X
              dismisses. Both have light haptics. */}
          <Pressable
            onPress={onChevron}
            hitSlop={8}
            style={styles.chevron}
            accessibilityRole="button"
          >
            <Animated.View style={chevronStyle}>
              <Feather
                name="chevron-down"
                size={18}
                color={isDark ? '#FFFFFF' : '#1A1A1A'}
              />
            </Animated.View>
          </Pressable>
          <Pressable
            onPress={startDismiss}
            hitSlop={8}
            style={styles.chevron}
            accessibilityRole="button"
            accessibilityLabel={t('common.close', 'Close')}
          >
            <Feather name="x" size={16} color={isDark ? 'rgba(255,255,255,0.7)' : 'rgba(20,20,20,0.6)'} />
          </Pressable>
        </View>

        {/* Expanded card body — renders unconditionally so the layout
            engine doesn't churn when toggling, but it's invisible (opacity
            0) and pointer-events disabled in the collapsed state. */}
        <Animated.View
          style={[styles.body, bodyStyle]}
          pointerEvents={expanded ? 'auto' : 'none'}
        >
          <View style={styles.tilesGrid}>
            {/* Theme tile — preview is a big colored ring + theme label */}
            <DashboardTile
              preview={
                <View style={{ alignItems: 'center', justifyContent: 'center' }}>
                  <View
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 19,
                      backgroundColor: accent,
                      borderWidth: 2,
                      borderColor: isDark ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.95)',
                      marginBottom: 4,
                    }}
                  />
                  <RNText
                    numberOfLines={1}
                    style={[styles.tilePreviewText, { color: isDark ? '#FFFFFF' : '#1A1A1A' }]}
                  >
                    {themeName}
                  </RNText>
                </View>
              }
              label={t('dynamic_overlay.theme', 'Theme')}
              onPress={goTheme}
              isDark={isDark}
              borderColor={tileBorder}
            />

            {/* Pixel-icon tile — live preview of the actual selected icon */}
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

            {/* Notifications tile — bell + actual unread count */}
            <DashboardTile
              preview={
                <View style={{ alignItems: 'center', justifyContent: 'center' }}>
                  <Feather name="bell" size={26} color={accent} style={{ marginBottom: 4 }} />
                  <RNText style={[styles.tileNumberValue, { color: isDark ? '#FFFFFF' : '#1A1A1A' }]}>
                    {unread > 99 ? '99+' : String(unread)}
                  </RNText>
                </View>
              }
              label={t('dynamic_overlay.notifications', 'Notifications')}
              onPress={goNotifications}
              isDark={isDark}
              borderColor={tileBorder}
            />

            {/* FPS tile — colored live FPS reading */}
            <DashboardTile
              preview={<FpsTilePreview accent={accent} isDark={isDark} />}
              label={t('dynamic_overlay.fps', 'FPS')}
              onPress={goPerf}
              isDark={isDark}
              borderColor={tileBorder}
            />
          </View>
        </Animated.View>

        {/* Hairline border — drawn last so it sits above blur + reflection. */}
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
    </View>
  );
}

export const DynamicOverlayHost = memo(DynamicOverlayHostInner);

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Full-screen container; `box-none` ensures the rest of the UI underneath
  // stays touchable. Only the pill / card itself catches touches.
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
  name: {
    fontSize: 13,
    fontWeight: '600',
    maxWidth: 90,
  },
  themeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  pixelWrap: {
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chevron: {
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Body of the expanded card. Sits BELOW the pill row and fills the rest.
  body: {
    flex: 1,
    paddingHorizontal: 14,
    paddingTop: 6,
    paddingBottom: 14,
    zIndex: 1,
  },
  tilesGrid: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 6,
  },
  tile: {
    width: '47%',
    aspectRatio: 1.05,
    borderRadius: 18,
    overflow: 'hidden',
    flexGrow: 1,
  },
  tileInner: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tilePreviewWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tilePreviewText: {
    fontSize: 12,
    fontWeight: '600',
    maxWidth: 110,
  },
  tileLabel: {
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.3,
    marginTop: 4,
    textTransform: 'uppercase',
  },
  tileNumberValue: {
    fontSize: 18,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
});

// Defensive default export to avoid accidental "default not found" errors if
// expo-router ever auto-imports the module path.
export default DynamicOverlayHost;
