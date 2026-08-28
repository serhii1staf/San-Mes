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
import { Platform, Pressable, StyleSheet, View } from 'react-native';
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

// ── GEOMETRY, AFTER TWO REPORTED DEFECTS ────────────────────────────────────
//
// Reported: on Android the emoji can be CLIPPED, and the capsule can be TOO LONG.
//
// Both were arithmetic, and both are worth writing down because the numbers have to agree.
//
// CLIPPING. `emojiTextStyle(size)` returns a lineHeight of `round(size * 1.3)` — that ratio exists
// because colour emoji need roughly 1.17-1.25x their nominal size and Android otherwise crops the top.
// The avatar box was `CIRCLE - PAD_H * 2` = 40 - 20 = 20 px, while `emojiTextStyle(20)` asks for a
// 26 px line box. A 26 px glyph box inside a 20 px container with `overflow: 'hidden'` on the capsule is
// exactly the clip. The constants are now derived so the box is always LARGER than the glyph:
// `EMOJI_SIZE` 18 → line box `round(18 * 1.3)` = 24, and `AVATAR` is 28.
//
// TOO LONG. Two separate over-counts. First the target width added `CIRCLE + PAD_H * 2`, but `CIRCLE`
// already contains its padding, so every pill was ~20 px wider than its content. Second, and much
// larger: the hidden measuring pass laid the name and the action out in a ROW while the real pill
// renders them as a COLUMN, so the measured width was `name + action` side by side instead of the wider
// of the two. A short name with a long action line came out nearly twice too wide.
/** Diameter of the phase-one circle, and the capsule's collapsed width/height. */
const CIRCLE = 44;
/** Padding inside the capsule, per side. Also what centres the avatar in the collapsed circle. */
const PAD_H = 8;
/** Avatar box. Derived so `CIRCLE = PAD_H + AVATAR + PAD_H` exactly, and > the emoji line box. */
const AVATAR = CIRCLE - PAD_H * 2;
/** Emoji point size. `AVATAR` must exceed `round(EMOJI_SIZE * 1.3)`; 18 → 24 < 28. */
const EMOJI_SIZE = 18;
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
  surface,
  border,
  children,
}: {
  isDark: boolean;
  surface: string;
  border: string;
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
  // ── ANDROID GETS MATERIAL, NOT A WASHED-OUT IMITATION OF GLASS ─────────────
  //
  // Reported: on Android this pill "does not support the blur we use". That is
  // accurate, and it is not an accident — `GlassCapsule` states plainly that
  // Android NEVER renders a BlurView, and falls back to a flat rgba fill. What it
  // then renders is a translucent slab with a white top-reflection gradient and a
  // dark bottom fade, i.e. the SHAPE of a glass highlight with no glass under it.
  // That reads as a faded rectangle, which is what was being described.
  //
  // Two reasons not to answer this by turning the blur on. The cheap one: the
  // stated cost argument is about a keyboard-coupled surface — "the chat input bar
  // sits just above the keyboard and the keyboard animation re-rasterizes any
  // BlurView above it" — and this pill is a 3.4-second overlay at the top of the
  // screen, so that specific reasoning does not transfer. The real one: on Android
  // a blur is the wrong idea regardless. A floating Material surface is a toned
  // container with a shadow, and faking a lens on a platform whose surfaces are
  // paper is exactly the mistake the platform-design work exists to stop.
  //
  // So: a real elevated Material surface. Tone from the app's own theme (so it
  // follows the in-app dark/light switch), plus a shadow, because M3 pairs
  // container tone WITH shadow for elements that genuinely float — resting
  // surfaces get tone alone. `elevation` is the Android channel for that; the
  // iOS-style shadow* props are set alongside so the same style is harmless if
  // this branch is ever reached on iOS with Reduce Transparency on, where a
  // toned surface is also the correct fallback.
  //
  // No reflection gradient and no bottom dim: both are glass cues, and their
  // absence is the point.
  if (Platform.OS === 'android') {
    return (
      <View
        style={[
          styles.material,
          {
            borderRadius: CIRCLE / 2,
            backgroundColor: surface,
            borderColor: border,
            shadowOpacity: isDark ? 0.38 : 0.2,
          },
        ]}
      >
        {children}
      </View>
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
  // Watchdog for the case where phase two never starts. See the note on the
  // measuring view's `key`: the auto-dismiss timer lives inside phase two, so if
  // the measurement never arrives there is nothing left to take the pill down and
  // it stays on screen forever, blocking every queued alert behind it. This is
  // deliberately independent of the measurement.
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expandedRef = useRef(false);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const clearWatchdog = () => {
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  };

  const finish = useCallback(() => {
    clearTimer();
    clearWatchdog();
    expandedRef.current = false;
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
    expandedRef.current = false;

    // Arm the watchdog for THIS alert. If phase two has not run by the time this
    // fires, the pill is stuck (no expand, no text, and no dismiss timer because
    // that timer is armed in phase two) — so retire the alert rather than leave it
    // on screen holding the queue. Generous relative to a measurement pass, which
    // lands on the next frame, so a healthy alert never reaches this.
    clearWatchdog();
    watchdogRef.current = setTimeout(() => {
      watchdogRef.current = null;
      if (expandedRef.current) return;
      finish();
    }, VISIBLE_MS);

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
    // Phase two reached: the watchdog above has nothing left to rescue.
    expandedRef.current = true;
    clearWatchdog();
    // `PAD_H + AVATAR + GAP + text + PAD_H`. Written from the parts rather than from `CIRCLE` so it
    // cannot double-count the padding `CIRCLE` already includes — that was one of the two over-counts.
    const target = Math.min(
      PAD_H + AVATAR + GAP + contentWidth + PAD_H,
      maxWidth * MAX_WIDTH_RATIO,
    );
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

  useEffect(() => () => { clearTimer(); clearWatchdog(); }, []);

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
      {/* Hidden measuring pass. This MUST mirror the real text column's layout — it is a COLUMN, not a
          row. Measuring it as a row summed the two lines' widths instead of taking the wider one, which
          is what made the capsule far too long. `alignSelf: 'flex-start'` keeps the column shrink-wrapped
          to its content instead of stretching to the full-width parent, which would measure the screen. */}
      <View style={styles.measure} pointerEvents="none" aria-hidden>
        {/* ── `key` IS THE FIX FOR "THE PILL BREAKS AFTER THE FIRST MESSAGE" ────
            Reported: the first alert or two look right, then the pill stops
            working.

            `onLayout` fires when a layout CHANGES. It is not a "measure me"
            request. On the second alert the swap branch above sets
            `contentWidth` back to null and collapses the capsule to a circle,
            then waits for this view to report its new width — but if the new
            alert renders to the SAME width, nothing changed, so React Native
            fires nothing. Two messages from the same person are exactly that
            case: same display name, same "sent you a message" line, identical
            measured width.

            `contentWidth` then stays null forever, and phase two bails on
            `contentWidth == null`. Phase two is also where the auto-dismiss
            timer is armed — so the pill does not merely fail to expand, it
            sticks on screen as a bare circle with its text faded out and never
            dismisses, and every later alert queues behind it. That is the
            failure, and it is a hard stick rather than a glitch.

            Keying by alert id remounts this subtree per alert, and a mount
            always produces one initial `onLayout`. The watchdog in the effect
            above is the second line of defence so no future change to this
            measurement can strand the pill again. */}
        <View
          key={current.id}
          onLayout={(e) => {
            const w = Math.ceil(e.nativeEvent.layout.width);
            if (w > 0) setContentWidth((prev) => (prev === w ? prev : w));
          }}
          style={styles.measureCol}
        >
          <Text variant="caption" weight="bold" numberOfLines={1}>
            {current.name}
          </Text>
          <Text variant="caption" numberOfLines={1}>
            {action}
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
        <GlassShell
          isDark={theme.isDark}
          surface={theme.colors.background.elevated || theme.colors.background.secondary}
          border={theme.colors.border.light}
        >
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
              <Text style={emojiTextStyle(EMOJI_SIZE)}>{current.emoji}</Text>
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
    // 28 px box for a 24 px emoji line box. See the geometry note at the top of the file: this container
    // must be LARGER than `round(EMOJI_SIZE * 1.3)` or Android crops the glyph.
    width: AVATAR,
    height: AVATAR,
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
  measureCol: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    alignSelf: 'flex-start',
  },
  glass: {
    overflow: 'hidden',
    flex: 1,
  },
  // Android's floating Material surface. `flex: 1` matches the glass branch so
  // both fill the animated capsule identically and the width morph looks the same
  // on both platforms. Shadow geometry is shared; only its opacity varies by
  // theme, set inline, because a cast shadow reads far weaker on a dark surface.
  material: {
    overflow: 'hidden',
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 6,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 8,
  },
});

export const InAppAlertHost = memo(InAppAlertHostInner);
export default InAppAlertHost;
