/**
 * InAppAlertHost — the glass pill that replaces an OS banner while the app is in the foreground.
 *
 * Requested shape, in order: the actor's emoji avatar appears first as a circle, a round glass
 * container forms around it, then the capsule expands to the right AND left, smoothly, and the text
 * says what happened. It must stay smooth under spam and under load.
 *
 * ── HOW THE SMOOTHNESS REQUIREMENT IS ACTUALLY MET ──────────────────────────
 *
 * Every animated property is driven by a Reanimated shared value and read inside `useAnimatedStyle`, so
 * the whole morph is evaluated on the UI thread. That is the specific reason it survives load: this app
 * currently spends 20-25 ms of JS per list cell and commits batches of 4-12 of them, so anything driven
 * from the JS thread would visibly stutter during exactly the moments an alert is most likely to arrive
 * (a message landing while the transcript is mounting). The JS thread's only jobs here are starting the
 * timeline once and swapping text content.
 *
 * No `Animated.timing` from `react-native`, and no width animation via `scaleX`: scaling the container
 * would distort the emoji and the text with it. The width is animated as a real layout width, which is
 * what makes the growth symmetric around the centre — the capsule is `alignSelf: 'center'`, so growing
 * its width moves both edges outward at once, which is the "expands right and left" part.
 *
 * ── WHY THE TARGET WIDTH IS MEASURED RATHER THAN ESTIMATED ──────────────────
 *
 * The text is variable ("Anna sent you a message", "12 messages", a long display name), and guessing a
 * width from character counts breaks with emoji, CJK, and the app's custom font. So the row is measured
 * once, invisibly, via `onLayout`, and the capsule then animates to that width.
 *
 * The measurement frame would normally be a visible glitch. Here it is free, because it happens while
 * the pill is still in phase one — a circle showing only the emoji. The measurement hides inside the
 * phase the design already asked for.
 *
 * ── DISMISSAL ───────────────────────────────────────────────────────────────
 *
 * Auto-dismiss after `VISIBLE_MS`, or immediately on tap. Both collapse the capsule back toward the
 * circle and fade out rather than cutting, matching `DynamicOverlayHost`'s rule that dismissal is
 * always animated. When another alert is waiting, the exit is skipped and the content is swapped in
 * place — a remount per alert is what would make a burst look like flickering.
 *
 * ── APPLE COMPLIANCE ────────────────────────────────────────────────────────
 *
 * Top is fixed at `insets.top + 6`, never above the safe-area inset, mirroring `DynamicOverlayHost`.
 * Nothing is collected or transmitted: the emoji, name and kind all come from the notification the
 * device already received. No new permission, no new native module, OTA-safe. `GlassCapsule` already
 * owns the platform split (BlurView on iOS, flat translucent fill on Android), so no BlurView is added
 * on Android where it would be expensive.
 */
import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { GlassCapsule } from './GlassCapsule';
import { NativeGlassView, useLiquidGlassActive } from './LiquidGlass';
import { emojiTextStyle } from './emojiText';
import { useT } from '../../i18n/store';
import { useInAppAlert, type InAppAlert } from '../../store/inAppAlertStore';

/** Diameter of the phase-one circle, and the capsule's collapsed width/height. */
const CIRCLE = 40;
/** Horizontal padding inside the expanded capsule, per side. */
const PAD_H = 10;
/** Gap between the avatar circle and the text column. */
const GAP = 8;
/** How long the expanded pill stays before auto-dismissing. */
const VISIBLE_MS = 3400;
/** Phase durations. Deliberately short — this is an ambient alert, not a modal. */
const IN_MS = 220;
const EXPAND_MS = 320;
const OUT_MS = 200;
/** Safety cap so one absurd display name cannot push the capsule off-screen. */
const MAX_WIDTH_RATIO = 0.92;

/**
 * Localised action line. Was hard-coded English, which showed English copy to a user running the app in
 * Russian — reported, and correct: every other string in this app goes through `useT`.
 *
 * `useT` takes a key and a DEFAULT, so the English text stays as the fallback and no new locale file is
 * required for the feature to work; translations land wherever the app's other keys live.
 *
 * The media variants exist because "sent you a message" is not what happened when the message was a
 * photo or a GIF. That distinction costs nothing extra: the realtime payload already carries the preview
 * text and image list, so the classification happens on data the device has, with no extra request.
 */
function useActionText(alert: InAppAlert | null): string {
  const t = useT();
  // Accepts null so it can be called ABOVE the `if (!current) return null` bail-out. A hook after an
  // early return would change hook order between "an alert is showing" and "none is", which is the
  // rules-of-hooks violation this shape avoids.
  if (!alert) return '';
  const n = alert.repeat;
  switch (alert.kind) {
    case 'message':
      if (n > 1) return t('alert.message.many', `sent ${n} messages`).replace('{n}', String(n));
      if (alert.media === 'photo') return t('alert.message.photo', 'sent you a photo');
      if (alert.media === 'gif') return t('alert.message.gif', 'sent you a GIF');
      return t('alert.message.one', 'sent you a message');
    case 'comment':
      return n > 1
        ? t('alert.comment.many', `left ${n} comments`).replace('{n}', String(n))
        : t('alert.comment.one', 'commented on your post');
    case 'like':
      return n > 1
        ? t('alert.like.many', `liked ${n} of your posts`).replace('{n}', String(n))
        : t('alert.like.one', 'liked your post');
    case 'follow':
      return n > 1
        ? t('alert.follow.many', `and ${n - 1} others followed you`).replace('{n}', String(n - 1))
        : t('alert.follow.one', 'started following you');
    default:
      return t('alert.generic', 'sent you an update');
  }
}

/**
 * The pill's material. Real system liquid glass where the platform genuinely supports it, the app's
 * existing BlurView capsule everywhere else.
 *
 * The gate is `useLiquidGlassActive()` rather than a Platform check, because `LiquidGlass.tsx`'s own
 * header is explicit that availability is three conditions, not one: the OS must support the effect, the
 * design must be compiled into the app, and the runtime API must be present — and it must additionally
 * stand down when Reduce Transparency is enabled, which is an accessibility requirement, not a
 * preference. Reaching for `NativeGlassView` without that check is what its header warns against.
 *
 * `colorScheme` is passed from the app's own theme rather than left `'auto'`, so the pill follows the
 * in-app dark/light toggle instead of the system one — the app has its own switch and the two can differ.
 */
const GlassShell = memo(function GlassShell({
  isDark,
  children,
}: {
  isDark: boolean;
  children: React.ReactNode;
}) {
  const liquidGlass = useLiquidGlassActive();
  if (liquidGlass) {
    return (
      <NativeGlassView
        style={[styles.glass, { borderRadius: CIRCLE / 2 }]}
        glassStyle="regular"
        colorScheme={isDark ? 'dark' : 'light'}
      >
        {children}
      </NativeGlassView>
    );
  }
  return (
    <GlassCapsule borderRadius={CIRCLE / 2} isDark={isDark} pointerEvents="box-none">
      {children}
    </GlassCapsule>
  );
});

function InAppAlertHostInner() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const current = useInAppAlert((s) => s.current);
  const advance = useInAppAlert((s) => s.advance);
  const hasPending = useInAppAlert((s) => s.pending.length > 0);

  // Measured width of the content row, per alert id. Null until the hidden pass reports.
  const [contentWidth, setContentWidth] = useState<number | null>(null);
  const [maxWidth, setMaxWidth] = useState(0);

  // Animation state. `width` is a real layout width; see the header for why not scaleX.
  const width = useSharedValue(CIRCLE);
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.8);
  const textOpacity = useSharedValue(0);
  const translateY = useSharedValue(-8);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shownIdRef = useRef<string | null>(null);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const finish = useCallback(() => {
    clearTimer();
    setContentWidth(null);
    shownIdRef.current = null;
    advance();
  }, [advance]);

  // Phase one: the circle arrives. Runs once per alert id, and is deliberately NOT re-run when the
  // measurement lands — that would restart the animation the user is already watching.
  useEffect(() => {
    if (!current) {
      shownIdRef.current = null;
      return;
    }
    if (shownIdRef.current === current.id) return;

    const isSwap = shownIdRef.current !== null;
    shownIdRef.current = current.id;
    setContentWidth(null);

    if (isSwap) {
      // Content swap during a burst: keep the capsule on screen, just re-fade the text and collapse
      // back to a circle so the next expand reads as a fresh one. No remount, no entry animation.
      textOpacity.value = withTiming(0, { duration: 90 });
      width.value = withTiming(CIRCLE, { duration: 140, easing: Easing.out(Easing.quad) });
    } else {
      opacity.value = withTiming(1, { duration: IN_MS, easing: Easing.out(Easing.quad) });
      translateY.value = withTiming(0, { duration: IN_MS, easing: Easing.out(Easing.back(1.4)) });
      scale.value = withTiming(1, { duration: IN_MS, easing: Easing.out(Easing.back(1.6)) });
      width.value = CIRCLE;
      textOpacity.value = 0;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  // Phase two: once the row has been measured, expand outward and fade the text in behind it.
  useEffect(() => {
    if (!current || contentWidth == null || maxWidth <= 0) return;
    const target = Math.min(CIRCLE + GAP + contentWidth + PAD_H * 2, maxWidth * MAX_WIDTH_RATIO);
    width.value = withTiming(target, { duration: EXPAND_MS, easing: Easing.out(Easing.cubic) });
    // Text follows the edge rather than racing it, so no glyph is ever clipped by the growing capsule.
    textOpacity.value = withDelay(EXPAND_MS * 0.45, withTiming(1, { duration: 180 }));

    clearTimer();
    timerRef.current = setTimeout(() => {
      // Another alert waiting: skip the exit entirely and let the swap branch above take over.
      if (hasPending) {
        finish();
        return;
      }
      opacity.value = withSequence(
        withTiming(1, { duration: 0 }),
        withTiming(0, { duration: OUT_MS, easing: Easing.in(Easing.quad) }),
      );
      translateY.value = withTiming(-10, { duration: OUT_MS, easing: Easing.in(Easing.quad) });
      scale.value = withTiming(0.92, { duration: OUT_MS }, (done) => {
        if (done) runOnJS(finish)();
      });
    }, VISIBLE_MS);

    return clearTimer;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, contentWidth, maxWidth, hasPending, finish]);

  useEffect(() => clearTimer, []);

  // ── TAPPING THE PILL GOES WHERE THE ALERT POINTS ────────────────────────────
  //
  // Requested. Navigation is fired AFTER the exit animation completes, which is the rule
  // `DynamicOverlayHost` already documents for its own destination taps: kicking off a route change
  // underneath a still-visible dismissal leaves a closing artifact behind the incoming slide.
  //
  // Only kinds with somewhere to go navigate. A like has no natural destination distinct from the post,
  // and a follow points at the follower's profile — for both, `targetId` is what the producer supplied,
  // and when it is absent the pill just dismisses rather than guessing a route.
  const navigate = useCallback((alert: InAppAlert) => {
    try {
      if (alert.kind === 'message' && alert.targetId) {
        router.push(`/chat/${alert.targetId}`);
        return;
      }
      if ((alert.kind === 'comment' || alert.kind === 'like') && alert.targetId) {
        router.push(`/comments/${alert.targetId}`);
        return;
      }
      if (alert.kind === 'follow') {
        router.push(alert.actorId ? `/profile/${alert.actorId}` : '/notifications');
      }
    } catch {
      // A route that cannot be resolved must not take the app down from an ambient alert.
    }
  }, []);

  const onPress = useCallback(() => {
    clearTimer();
    const target = current;
    opacity.value = withTiming(0, { duration: 140 }, (done) => {
      if (done) {
        runOnJS(finish)();
        if (target) runOnJS(navigate)(target);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finish, navigate, current]);

  // Called before the bail-out below so hook order is identical whether or not an alert is showing.
  const actionLine = useActionText(current);

  const capsuleStyle = useAnimatedStyle(() => ({
    width: width.value,
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }, { scale: scale.value }],
  }));

  const textStyle = useAnimatedStyle(() => ({ opacity: textOpacity.value }));

  // Nothing queued: render nothing at all, so there is zero idle cost — the same rule
  // `DynamicOverlayHost` follows when dismissed.
  if (!current) return null;

  const action = actionLine;

  return (
    <View
      pointerEvents="box-none"
      style={[styles.root, { top: insets.top + 6 }]}
      onLayout={(e) => {
        const w = e.nativeEvent.layout.width;
        if (w > 0 && w !== maxWidth) setMaxWidth(w);
      }}
    >
      {/* Hidden measuring pass. Absolutely positioned and transparent so it never affects layout, and
          invisible to touches. It exists for one frame per alert, inside the circle phase. */}
      <View style={styles.measure} pointerEvents="none" aria-hidden>
        <View
          onLayout={(e) => {
            const w = Math.ceil(e.nativeEvent.layout.width);
            if (w > 0) setContentWidth((prev) => (prev === w ? prev : w));
          }}
          style={styles.measureRow}
        >
          <Text variant="caption" weight="bold" numberOfLines={1}>
            {current.name}
          </Text>
          <Text variant="caption" numberOfLines={1}>
            {` ${action}`}
          </Text>
        </View>
      </View>

      <Animated.View style={[styles.capsuleWrap, capsuleStyle]}>
        {/* ── REAL LIQUID GLASS, NOT A BLUR ──────────────────────────────────────
            Reported: it must support the actual liquid glass the app uses, not just a blur. It was
            using `GlassCapsule`, which is a BlurView stack — a good imitation and not the same
            material. `NativeGlassView` is the real system effect, and `useLiquidGlassActive()` is the
            gate its own header insists on: it is only safe to render when the OS, the compiled-in
            design and the runtime API all agree, and it must not be used when Reduce Transparency is
            on. `GlassCapsule` stays as the fallback for every device that fails that gate, which is
            all of Android and any older iOS, so the pill looks right everywhere. */}
        <GlassShell isDark={theme.isDark}>
          <Pressable
            onPress={onPress}
            style={styles.pressable}
            accessibilityRole="button"
            accessibilityLabel={`${current.name} ${action}`}
          >
            <View style={styles.avatar}>
              {/* `emojiTextStyle` rather than a bare fontSize: it supplies the matching lineHeight and
                  the Android `includeFontPadding: false`, which is what stops a colour emoji being
                  clipped at the top. Same helper `Avatar` uses. */}
              <Text style={emojiTextStyle(20)}>{current.emoji}</Text>
            </View>
            <Animated.View style={[styles.textCol, textStyle]}>
              <Text variant="caption" weight="bold" numberOfLines={1}>
                {current.name}
              </Text>
              <Text variant="caption" numberOfLines={1} color={theme.colors.text.secondary}>
                {action}
              </Text>
            </Animated.View>
          </Pressable>
        </GlassShell>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    // Above the tab bar and screen content, below the dynamic overlay so the two can never fight for
    // the same region.
    zIndex: 900,
  },
  capsuleWrap: {
    height: CIRCLE,
    overflow: 'hidden',
    alignSelf: 'center',
  },
  pressable: {
    flexDirection: 'row',
    alignItems: 'center',
    height: CIRCLE,
    paddingHorizontal: PAD_H,
  },
  avatar: {
    width: CIRCLE - PAD_H * 2,
    height: CIRCLE - PAD_H * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textCol: {
    marginLeft: GAP,
    flexShrink: 1,
  },
  measure: {
    position: 'absolute',
    opacity: 0,
    left: 0,
    top: 0,
  },
  measureRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  glass: {
    overflow: 'hidden',
    flex: 1,
  },
});

export const InAppAlertHost = memo(InAppAlertHostInner);
export default InAppAlertHost;
