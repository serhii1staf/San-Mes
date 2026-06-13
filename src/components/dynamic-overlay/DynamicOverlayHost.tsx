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
 * cost. The transparent gesture catcher at the top of the screen
 * (`DynamicOverlayTrigger`) is what summons it.
 *
 * Apple compliance:
 *  - We position strictly within `insets.top + 6` and below. Apple Review
 *    flags overlays that draw INTO the system status bar. The notch and
 *    the system clock / battery icons stay visible at all times.
 *  - We do NOT render INSIDE the Dynamic Island region itself — that
 *    space is reserved for ActivityKit. Wrapping around it (margin from
 *    the edges + sitting just below the inset) is permitted UI design.
 *  - No new permissions, no new native modules, OTA-safe.
 *
 * Performance:
 *  - All state transitions live on the UI thread via Reanimated.
 *  - The FPS tile only subscribes to `perfMonitor` when the perf monitor
 *    is enabled in settings; otherwise it shows a "—" placeholder so we
 *    don't pay for FPS sampling we won't display.
 *  - Auto-dismiss is a single setTimeout in the collapsed state, cleared
 *    eagerly on every interaction.
 */

import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
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
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../../theme';
import { useT } from '../../i18n/store';
import { useAuthStore } from '../../store/authStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useNotificationsBadge } from '../../store/notificationsBadgeStore';
import { useDynamicOverlayStore } from '../../store/dynamicOverlayStore';
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

// ─── Glass material ─────────────────────────────────────────────────────────
//
// Same recipe as `CustomTabBar`'s `GlassBackdrop` + top reflection — system
// chrome BlurView with an iOS system-material tint, plus a soft top gradient
// to give the surface its rounded-glass volume. Drawn behind the content.

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

function DashboardTile({
  icon,
  label,
  value,
  onPress,
  accent,
  isDark,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  value: React.ReactNode;
  onPress: () => void;
  accent: string;
  isDark: boolean;
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
            StyleSheet.absoluteFill,
            {
              backgroundColor: accent + (isDark ? '22' : '14'),
            },
          ]}
        />
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              borderRadius: 18,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: isDark ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.6)',
            },
          ]}
        />
      </View>

      <View style={styles.tileInner}>
        <Feather name={icon} size={20} color={accent} />
        <RNText
          numberOfLines={1}
          style={[styles.tileLabel, { color: isDark ? '#FFFFFF' : '#1A1A1A' }]}
        >
          {label}
        </RNText>
        <RNText
          numberOfLines={1}
          style={[
            styles.tileValue,
            { color: isDark ? 'rgba(255,255,255,0.65)' : 'rgba(20,20,20,0.6)' },
          ]}
        >
          {value}
        </RNText>
      </View>
    </Pressable>
  );
}

// ─── FPS tile — only subscribes when perf monitor is on ─────────────────────

function FpsTileValue() {
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
      // Throttle to ≈2 Hz so the tile re-renders at most twice a second.
      if (now - last < 480) return;
      last = now;
      setFps(s.jsFps || 0);
    });
    return unsub;
  }, [enabled]);

  // Em-dash placeholder when the monitor is off — the tile still works as
  // a tap-target to open the panel, just without the live number.
  return <>{fps == null ? '—' : String(fps)}</>;
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

  // Subscribe with field selectors so unrelated profile / icon changes don't
  // re-render the host tree on every keystroke elsewhere.
  const userEmoji = useAuthStore((s) => s.user?.emoji);
  const userAvatar = useAuthStore((s) => s.user?.avatar);
  const userDisplayName = useAuthStore((s) => s.user?.displayName);
  const homeHeaderIcon = useSettingsStore((s) => s.homeHeaderIcon);
  const unread = useNotificationsBadge((s) => s.unread);

  const accent = theme.colors.accent.primary;

  // Truncate long display names to "first 6 chars + …" so the pill stays
  // narrow. Memoised because the input rarely changes but we mount this
  // every time the overlay opens.
  const shortName = useMemo(() => {
    const name = userDisplayName || '';
    if (!name) return '';
    return name.length > 6 ? name.slice(0, 6) + '…' : name;
  }, [userDisplayName]);

  // ─── Reanimated progress 0 (collapsed) → 1 (expanded) ────────────────
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withSpring(expanded ? 1 : 0, SPRING);
  }, [expanded, progress]);

  // Backdrop fades in slightly when expanded so the rest of the screen
  // dims behind the card.
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      progress.value,
      [0, 1],
      [0, 0.35],
      Extrapolation.CLAMP,
    ),
  }));

  // Container animates width / height / left / radius simultaneously so
  // the morph reads as a single fluid expand rather than two disjoint
  // anim tracks.
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
        hide();
      }, AUTO_DISMISS_MS);
    }
    return clearDismissTimer;
  }, [visible, expanded, hide, clearDismissTimer]);

  // ─── Interaction handlers ────────────────────────────────────────────
  const onChevron = useCallback(() => {
    clearDismissTimer();
    triggerHaptic('selection');
    toggleExpand();
  }, [toggleExpand, clearDismissTimer]);

  const onBackdrop = useCallback(() => {
    clearDismissTimer();
    triggerHaptic('light');
    hide();
  }, [hide, clearDismissTimer]);

  const goTheme = useCallback(() => {
    clearDismissTimer();
    hide();
    router.push('/settings/appearance');
  }, [hide, clearDismissTimer]);

  const goIcon = useCallback(() => {
    clearDismissTimer();
    hide();
    router.push('/settings/pixel-icons?purpose=home-header');
  }, [hide, clearDismissTimer]);

  const goNotifications = useCallback(() => {
    clearDismissTimer();
    hide();
    router.push('/notifications');
  }, [hide, clearDismissTimer]);

  // The perf-monitor panel opens via the bubble's modal flow — the bubble
  // itself owns that panel. We can't reach into it from here, so the FPS
  // tile just opens settings (closest accessible flow).
  const goPerf = useCallback(() => {
    clearDismissTimer();
    hide();
    router.push('/settings/storage');
  }, [hide, clearDismissTimer]);

  if (!visible) return null;

  const fpsLabel = t('dynamic_overlay.fps', 'FPS');

  return (
    <View style={styles.root} pointerEvents="box-none">
      {/* Backdrop — covers the WHOLE screen below the safe area top so the
          system clock / notch / camera island remain untouched. Tap to
          dismiss. */}
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: '#000', top: insets.top },
          backdropStyle,
        ]}
        pointerEvents={expanded ? 'auto' : 'box-none'}
      >
        <Pressable onPress={onBackdrop} style={StyleSheet.absoluteFill} />
      </Animated.View>

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
        <View style={styles.pillRow} pointerEvents="box-none">
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

          {/* Chevron — rotates 180° when expanded */}
          <Pressable
            onPress={onChevron}
            hitSlop={8}
            style={styles.chevron}
            accessibilityRole="button"
            accessibilityLabel={
              expanded
                ? t('common.close', 'Close')
                : t('dynamic_overlay.dismiss_hint', 'Tap outside to dismiss')
            }
          >
            <Animated.View style={chevronStyle}>
              <Feather
                name="chevron-down"
                size={18}
                color={isDark ? '#FFFFFF' : '#1A1A1A'}
              />
            </Animated.View>
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
            <DashboardTile
              icon="droplet"
              label={t('dynamic_overlay.theme', 'Theme')}
              value={t('common.edit', 'Edit')}
              onPress={goTheme}
              accent={accent}
              isDark={isDark}
            />
            <DashboardTile
              icon="image"
              label={t('dynamic_overlay.icon', 'Icon')}
              value={homeHeaderIcon ? '✓' : '—'}
              onPress={goIcon}
              accent={accent}
              isDark={isDark}
            />
            <DashboardTile
              icon="bell"
              label={t('dynamic_overlay.notifications', 'Notifications')}
              value={unread > 0 ? String(unread) : '0'}
              onPress={goNotifications}
              accent={accent}
              isDark={isDark}
            />
            <DashboardTile
              icon="activity"
              label={fpsLabel}
              value={<FpsTileValue />}
              onPress={goPerf}
              accent={accent}
              isDark={isDark}
            />
          </View>

          <RNText
            numberOfLines={1}
            style={[
              styles.dismissHint,
              { color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(20,20,20,0.55)' },
            ]}
          >
            {t('dynamic_overlay.dismiss_hint', 'Tap outside to dismiss')}
          </RNText>
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
  // Full-screen container; children opt out of touch interception via
  // `pointerEvents` so the rest of the app stays interactive when the
  // overlay is collapsed.
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
    justifyContent: 'space-between',
  },
  tileLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  tileValue: {
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  dismissHint: {
    fontSize: 11,
    textAlign: 'center',
    marginTop: 8,
  },
});

// Defensive default export to avoid accidental "default not found" errors if
// expo-router ever auto-imports the module path.
export default DynamicOverlayHost;

// Touch SCREEN_HEIGHT/SCREEN_WIDTH at module load so RN's Dimensions cache
// is primed; otherwise the first read inside `containerStyle` may sit on
// the JS thread for a few ms on cold start.
void Dimensions.get('window');
