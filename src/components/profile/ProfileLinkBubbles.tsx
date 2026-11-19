/**
 * Profile links as floating liquid drops, in the space beside the avatar (the idea of Telegram's
 * profile gifts).
 *
 * Each drop is a blob of coloured gel in the link's brand colour. It slowly turns and squashes, so
 * its outline never looks the same twice; something lighter swirls inside it; it drifts on its own
 * rhythm; it can be grabbed and pulled anywhere and springs home with a wobble. Push one drop into
 * another and the other one bursts into droplets that fall, then pops back together with a hop.
 * A tap opens the link.
 *
 * ── TRANSFORMS ONLY ─────────────────────────────────────────────────────────
 *
 * The previous version rebuilt each drop's SVG path every frame. That is the most expensive kind of
 * animation there is here: each frame went through a shadow-tree commit and react-native-svg then
 * re-parsed and redrew the path on the main thread. It was visible as the drops "twitching" and was
 * part of the profile's lag. Now every SVG is drawn ONCE, and only rotation, scale, translation and
 * opacity change, which the compositor applies without redrawing anything.
 *
 * The loop starts after the open transition and stops while the screen is not focused (the own
 * profile tab stays mounted behind the other tabs) or when Reduce Motion is on.
 *
 * ── THE IDLE LOOP IS ON THE NATIVE ANIMATED DRIVER ──────────────────────────
 *
 * The drift, turn and squash run for as long as a profile with links is open, so their per-frame cost
 * is that profile's idle cost. As Reanimated styles they were three shadow-tree commits per drop per
 * frame (each a layout pass and a mount); Reanimated 4.1 has no faster path for them on iOS. Measured
 * on the Android emulator, a profile with three links rendered continuously at about 14 fps while
 * nothing was touched. The native driver sets layer transforms directly, off the JS thread and outside
 * the shadow tree. The curves are the same, sampled into interpolation ranges over one value that runs
 * 0 → 1 per period. Dragging, popping and the hop stay on Reanimated: they only run while touched.
 *
 * The droplets a drop bursts into (seven animated views per drop) mount when any drop is first
 * grabbed, which is the only way a burst can start, instead of on every profile open.
 */
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated as RNAnimated, Easing as RNEasing, StyleSheet, View, useWindowDimensions } from 'react-native';
import { FontAwesome5 } from '@expo/vector-icons';
import Svg, { Defs, Ellipse, Path, RadialGradient, Stop } from 'react-native-svg';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Reanimated, {
  Easing,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { triggerHaptic } from '../../utils/haptics';
import { openUrl } from '../../utils/openUrl';
import { useT } from '../../i18n/store';
// Detection by HOST, shared with the editor. The local copy here matched substrings, which is how a
// Roblox link (`roblox.com` contains `x.com`) came out as Twitter. Icon and gel colour per kind live
// there too; brands whose own colour is black or white get a colour from the same family, so every
// drop has colour.
import { detectLinkKind, linkKindInfo } from '../../utils/linkKind';
import { useTransitionSettled } from '../../hooks/useTransitionSettled';

/** Drop diameters, by index. Different sizes read as a cluster rather than a row of buttons. */
const SIZES = [60, 52, 56, 48, 54];

/** Drop centres as fractions of the area, for 1..5 links. Staggered so neighbours never touch. */
const LAYOUTS: [number, number][][] = [
  [[0.5, 0.5]],
  [[0.3, 0.42], [0.72, 0.6]],
  [[0.18, 0.56], [0.52, 0.32], [0.84, 0.6]],
  [[0.12, 0.38], [0.4, 0.68], [0.66, 0.3], [0.9, 0.64]],
  [[0.1, 0.62], [0.32, 0.28], [0.54, 0.7], [0.75, 0.3], [0.94, 0.66]],
];

/** `#RRGGBB` mixed toward `#RRGGBB` by `w` (0..1). */
function mix(a: string, b: string, w: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (shift: number) => Math.round(((pa >> shift) & 255) * (1 - w) + ((pb >> shift) & 255) * w);
  return `#${((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1)}`;
}

const TAU = Math.PI * 2;
const POINTS = 6;
// Control-point distance that makes six evenly spaced points draw a circle: (4/3)·tan(15°)·R over
// the 1.732·R chord between a point's neighbours.
const SMOOTH = 0.357 / 1.732;

/** A closed, smooth, slightly irregular blob around (cx, cy). Drawn once per drop. */
function blobPath(cx: number, cy: number, R: number, seed: number, amp: number): string {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < POINTS; i++) {
    const a = (i / POINTS) * TAU;
    const r = R * (1 + amp * Math.sin(seed + i * 1.9) + amp * 0.45 * Math.sin(seed * 0.7 + i * 0.8));
    xs.push(cx + r * Math.cos(a));
    ys.push(cy + r * Math.sin(a));
  }
  let d = `M${xs[0].toFixed(2)} ${ys[0].toFixed(2)}`;
  for (let i = 0; i < POINTS; i++) {
    const i0 = (i + POINTS - 1) % POINTS;
    const i2 = (i + 1) % POINTS;
    const i3 = (i + 2) % POINTS;
    const c1x = xs[i] + (xs[i2] - xs[i0]) * SMOOTH;
    const c1y = ys[i] + (ys[i2] - ys[i0]) * SMOOTH;
    const c2x = xs[i2] - (xs[i3] - xs[i]) * SMOOTH;
    const c2y = ys[i2] - (ys[i3] - ys[i]) * SMOOTH;
    d += ` C${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${xs[i2].toFixed(2)} ${ys[i2].toFixed(2)}`;
  }
  return `${d}Z`;
}

/**
 * `base + amp·sin(2π·k·u + phase)` for u in [0, 1], sampled for `Animated.Value.interpolate`. Eight
 * samples per cycle: linear interpolation then stays within about 8 % of the amplitude, which at these
 * amplitudes (3 pt, or 5 % of a scale) is below what can be seen.
 */
function sineRange(k: number, phase: number, amp: number, base = 0) {
  const steps = Math.max(8, Math.ceil(k * 8));
  const inputRange: number[] = [];
  const outputRange: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    inputRange.push(u);
    outputRange.push(base + amp * Math.sin(TAU * k * u + phase));
  }
  return { inputRange, outputRange };
}

const DROPLETS = 7;

/** One of the droplets a popped drop bursts into: flies out, falls, fades. Idle = invisible. */
const Droplet = memo(function Droplet({ burst, index, size, color }: { burst: SharedValue<number>; index: number; size: number; color: string }) {
  const angle = (index / DROPLETS) * TAU + ((index * 53) % 10) / 20;
  const dist = size * (0.55 + (((index * 37) % 10) / 10) * 0.4);
  const d = Math.round(size * (0.16 + ((index * 29) % 10) / 90));
  const style = useAnimatedStyle(() => {
    const b = burst.value;
    const visible = b > 0.001 && b < 0.999;
    return {
      // Fully visible while they fly out, fading only as they fall.
      opacity: visible ? 1 - b * b : 0,
      transform: [
        { translateX: Math.cos(angle) * dist * b },
        // Out along its angle, then gravity takes over.
        { translateY: Math.sin(angle) * dist * b * 0.8 + size * 1.3 * b * b },
        { scale: 1 - 0.5 * b },
      ],
    };
  });
  return (
    <Reanimated.View
      pointerEvents="none"
      style={[{ position: 'absolute', left: size / 2 - d / 2, top: size / 2 - d / 2, width: d, height: d, borderRadius: d / 2, backgroundColor: color }, style]}
    />
  );
});

interface BubbleProps {
  url: string;
  size: number;
  left: number;
  top: number;
  index: number;
  running: boolean;
  websiteLabel: string;
  /** Every drop's resting centre and radius, in the field's coordinates, for collisions. */
  centers: number[][];
  pops: SharedValue<number[]>;
  lastPop: SharedValue<number[]>;
  /** Whether the burst droplets are mounted. Set once any drop has been grabbed. */
  armed: boolean;
  onGrab: () => void;
}

const Bubble = memo(function Bubble({ url, size, left, top, index, running, websiteLabel, centers, pops, lastPop, armed, onGrab }: BubbleProps) {
  const kind = detectLinkKind(url);
  const brand = linkKindInfo(kind);
  const dx = useSharedValue(0);
  const dy = useSharedValue(0);
  const scale = useSharedValue(1);
  const pop = useSharedValue(1);
  const hop = useSharedValue(0);
  const burst = useSharedValue(0);

  // Each drop has its own period and phase so the cluster never moves in step. One full turn of
  // the blob per period; every other motion is a whole number of cycles per period, so the loop
  // wrapping from 1 back to 0 is seamless.
  const period = 9000 + index * 1300;
  const phase = index * 1.37;
  const dir = index % 2 === 0 ? 1 : -1;
  const R = size / 2;
  const cx = left + R;
  const cy = top + R;

  // 0 → 1 per period, on the native driver. See the note at the top of the file.
  const loop = useRef(new RNAnimated.Value(0)).current;
  useEffect(() => {
    if (!running) {
      loop.stopAnimation();
      return;
    }
    const anim = RNAnimated.loop(
      RNAnimated.timing(loop, { toValue: 1, duration: period, easing: RNEasing.linear, useNativeDriver: true }),
    );
    // From the start of a cycle: the loop resets to the value it started from on every iteration.
    loop.setValue(0);
    anim.start();
    return () => anim.stop();
  }, [running, loop, period]);

  // The idle motion, as functions of the cycle. Each drop starts `index * 0.17` of a cycle in, so the
  // cluster does not move in step; that offset is folded into each curve's phase.
  const idle = useMemo(() => {
    const start = index * 0.17;
    const at = (k: number) => TAU * k * start + phase;
    const fx = sineRange(2, at(2), 3);
    const fy = sineRange(3, at(3) + Math.PI / 2, 3.5);
    const sx = sineRange(4, at(4), 0.05, 1);
    const sy = sineRange(4, at(4) + 2.1, 0.05, 1);
    const sw = sineRange(3, at(3), 0.08, 1);
    return {
      drift: {
        transform: [
          { translateX: loop.interpolate(fx) },
          { translateY: loop.interpolate(fy) },
        ],
      },
      // The outline: an irregular blob, turned and squashed. The squash is in the blob's own (rotating)
      // frame, so the silhouette keeps changing instead of just spinning.
      body: {
        transform: [
          { rotate: loop.interpolate({ inputRange: [0, 1], outputRange: [`${dir * start * 360}deg`, `${dir * (start + 1) * 360}deg`] }) },
          { scaleX: loop.interpolate(sx) },
          { scaleY: loop.interpolate(sy) },
        ],
      },
      // The lighter liquid inside orbits the other way, off-centre.
      swirl: {
        transform: [
          { rotate: loop.interpolate({ inputRange: [0, 1], outputRange: [`${-dir * start * 720}deg`, `${-dir * (start + 1) * 720}deg`] }) },
          { translateX: R * 0.14 },
          { scale: loop.interpolate(sw) },
        ],
      },
    };
  }, [loop, index, phase, dir, R]);

  const open = useCallback(() => {
    triggerHaptic('light');
    openUrl(url);
  }, [url]);
  // The held drop rides above its neighbours (siblings paint in order otherwise). Set once per
  // grab and once per release, never per frame.
  const [lifted, setLifted] = useState(false);
  const grabbed = useCallback(() => {
    triggerHaptic('selection');
    setLifted(true);
    onGrab();
  }, [onGrab]);
  const released = useCallback(() => setLifted(false), []);
  const popped = useCallback(() => triggerHaptic('light'), []);

  // Burst, then pop back together with a hop. Runs when another drop is pushed into this one.
  useAnimatedReaction(
    () => pops.value[index],
    (cur, prev) => {
      if (prev === null || prev === undefined || cur === prev) return;
      burst.value = 0;
      burst.value = withTiming(1, { duration: 760, easing: Easing.out(Easing.quad) });
      pop.value = withSequence(
        withTiming(1.25, { duration: 70, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: 90, easing: Easing.in(Easing.quad) }),
        withDelay(560, withSpring(1, { damping: 6.5, stiffness: 190, mass: 0.7 })),
      );
      hop.value = withSequence(
        withTiming(0, { duration: 160 }),
        withDelay(560, withSequence(
          withTiming(-16, { duration: 170, easing: Easing.out(Easing.quad) }),
          withSpring(0, { damping: 9, stiffness: 220 }),
        )),
      );
      runOnJS(popped)();
    },
  );

  const gesture = useMemo(() => {
    // Both gestures BEGIN on touch-down; the pan only STARTS once the finger has moved. So the
    // press-in lives on the tap's begin, the grab on the pan's start, and the one reset that always
    // runs is the pan's finalize (it fires for every touch that began, tap or drag).
    // The drops sit inside the profile's ScrollView. A quick swipe that starts on one must still
    // scroll the page, so the drag only engages after a short hold ("grab the drop"). A hold
    // released without moving is still a tap.
    const pan = Gesture.Pan()
      .activateAfterLongPress(140)
      .onStart(() => {
        scale.value = withSpring(1.12, { damping: 12, stiffness: 260 });
        runOnJS(grabbed)();
      })
      .onChange((e) => {
        dx.value += e.changeX;
        dy.value += e.changeY;
        // Pushed into another drop: that one bursts (at most once per 1.3 s each).
        const mx = cx + dx.value;
        const my = cy + dy.value;
        for (let j = 0; j < centers.length; j++) {
          if (j === index) continue;
          const o = centers[j];
          const ddx = mx - o[0];
          const ddy = my - o[1];
          const reach = (R + o[2]) * 0.78;
          if (ddx * ddx + ddy * ddy < reach * reach) {
            const now = Date.now();
            const lp = lastPop.value;
            if (now - (lp[j] || 0) > 1300) {
              const nl = lp.slice();
              nl[j] = now;
              lastPop.value = nl;
              const np = pops.value.slice();
              np[j] = (np[j] || 0) + 1;
              pops.value = np;
            }
          }
        }
      })
      .onEnd((e) => {
        if (Math.abs(e.translationX) < 6 && Math.abs(e.translationY) < 6) runOnJS(open)();
      })
      .onFinalize((e) => {
        // Low damping is the liquid part: it overshoots home and settles with a wobble.
        dx.value = withSpring(0, { velocity: e.velocityX, damping: 7, stiffness: 120, mass: 0.9 });
        dy.value = withSpring(0, { velocity: e.velocityY, damping: 7, stiffness: 120, mass: 0.9 });
        scale.value = withSpring(1, { damping: 6, stiffness: 180 });
        runOnJS(released)();
      });
    const tap = Gesture.Tap()
      .maxDuration(400)
      .onBegin(() => {
        scale.value = withSpring(0.9, { damping: 14, stiffness: 320 });
      })
      .onEnd((_e, success) => {
        if (success) runOnJS(open)();
      });
    return Gesture.Race(pan, tap);
  }, [dx, dy, scale, open, grabbed, released, centers, index, cx, cy, R, pops, lastPop]);

  // Only what a touch moves. The idle drift is on the native driver, on a view inside this one.
  const containerStyle = useAnimatedStyle(() => {
    // Stretch along the pull while it is held away from home.
    const pull = Math.min(1, Math.sqrt(dx.value * dx.value + dy.value * dy.value) / 140);
    const s = scale.value * pop.value;
    return {
      transform: [
        { translateX: dx.value },
        { translateY: dy.value + hop.value },
        { scaleX: s * (1 + pull * 0.08) },
        { scaleY: s * (1 - pull * 0.08) },
      ],
    };
  });

  const gel = brand.gel;
  const light = mix(gel, '#FFFFFF', 0.5);
  const deep = mix(gel, '#000000', 0.32);
  const canvas = Math.round(size * 1.2);
  const c = canvas / 2;
  const iconSize = Math.round(size * 0.38);
  const id = `${kind}${index}`;
  // Drawn once. Only the views holding them move.
  const outline = useMemo(() => blobPath(c, c, R, 1.3 + index * 2.1, 0.07), [c, R, index]);
  const inner = useMemo(() => blobPath(c, c, R * 0.5, 4.2 + index * 1.7, 0.16), [c, R, index]);
  const canvasBox = { position: 'absolute' as const, left: (size - canvas) / 2, top: (size - canvas) / 2, width: canvas, height: canvas };

  return (
    <>
      <GestureDetector gesture={gesture}>
        <Reanimated.View
          accessible
          accessibilityRole="link"
          accessibilityLabel={brand.label || websiteLabel}
          style={[{ position: 'absolute', left, top, width: size, height: size, zIndex: lifted ? 10 : 0 }, containerStyle]}
        >
          <RNAnimated.View pointerEvents="none" style={[StyleSheet.absoluteFill, idle.drift]}>
          <RNAnimated.View pointerEvents="none" style={[canvasBox, idle.body]}>
            <Svg width={canvas} height={canvas}>
              <Defs>
                {/* Gel shading: lit from the top left, deeper colour toward the far edge. */}
                <RadialGradient id={`b${id}`} cx="36%" cy="30%" r="78%">
                  <Stop offset="0" stopColor={light} />
                  <Stop offset="0.55" stopColor={gel} />
                  <Stop offset="1" stopColor={deep} />
                </RadialGradient>
              </Defs>
              <Path d={outline} fill={`url(#b${id})`} fillOpacity={0.95} stroke="#FFFFFF" strokeOpacity={0.35} strokeWidth={1} />
            </Svg>
          </RNAnimated.View>
          <RNAnimated.View pointerEvents="none" style={[canvasBox, idle.swirl]}>
            <Svg width={canvas} height={canvas}>
              <Path d={inner} fill="#FFFFFF" fillOpacity={0.16} />
            </Svg>
          </RNAnimated.View>
          {/* Specular highlight: does NOT turn with the blob, so the light stays put. */}
          <View pointerEvents="none" style={canvasBox}>
            <Svg width={canvas} height={canvas}>
              <Defs>
                <RadialGradient id={`h${id}`} cx="50%" cy="50%" r="50%">
                  <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.9} />
                  <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
                </RadialGradient>
              </Defs>
              <Ellipse
                cx={c - R * 0.27}
                cy={c - R * 0.35}
                rx={R * 0.3}
                ry={R * 0.17}
                fill={`url(#h${id})`}
                transform={`rotate(-28 ${c - R * 0.27} ${c - R * 0.35})`}
              />
            </Svg>
          </View>
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center]}>
            {brand.brand ? (
              <FontAwesome5 name={brand.icon} size={iconSize} color="#FFFFFF" brand style={styles.iconShadow} />
            ) : (
              <FontAwesome5 name={brand.icon} size={Math.round(iconSize * 0.9)} color="#FFFFFF" solid style={styles.iconShadow} />
            )}
          </View>
          </RNAnimated.View>
        </Reanimated.View>
      </GestureDetector>
      {/* Droplets live outside the drop, so they keep flying while the drop itself is gone. Mounted
          once a drop has been grabbed: a burst only happens when another drop is dragged into this one. */}
      {armed ? (
        <View pointerEvents="none" style={{ position: 'absolute', left, top, width: size, height: size }}>
          {Array.from({ length: DROPLETS }, (_, i) => (
            <Droplet key={i} burst={burst} index={i} size={size} color={i % 3 === 0 ? light : gel} />
          ))}
        </View>
      ) : null}
    </>
  );
});

/**
 * The drop field. Lays itself out in the header to the right of the avatar; `active` should be
 * the screen's focus state so the loop stops when the profile is not on screen.
 */
export const ProfileLinkBubbles = memo(function ProfileLinkBubbles({
  links,
  top,
  left,
  height,
  active,
}: {
  links: { url: string }[];
  top: number;
  left: number;
  height: number;
  active: boolean;
}) {
  const t = useT();
  const { width } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  // The drift starts once the push animation is over, so the two never share frames.
  const settled = useTransitionSettled();
  const pops = useSharedValue<number[]>([0, 0, 0, 0, 0]);
  const lastPop = useSharedValue<number[]>([0, 0, 0, 0, 0]);
  const [armed, setArmed] = useState(false);
  const arm = useCallback(() => setArmed(true), []);

  const list = links.slice(0, 5);
  const areaW = Math.max(0, width - left - 12);
  const layout = LAYOUTS[list.length - 1];
  const placed = useMemo(() => {
    if (!layout) return [];
    return list.map((_, i) => {
      const size = SIZES[i];
      const [fx, fy] = layout[i];
      const cx = Math.min(areaW - size / 2, Math.max(size / 2, fx * areaW));
      const cy = Math.min(height - size / 2, Math.max(size / 2, fy * height));
      return { size, cx, cy };
    });
    // `list` is derived from `links`; its length and the area are what the layout depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, list.length, areaW, height]);
  const centers = useMemo(() => placed.map((p) => [p.cx, p.cy, p.size / 2]), [placed]);
  // ── BUILT AFTER THE PUSH ANIMATION, THEN FADED IN ─────────────────────────
  // Each drop is about a dozen views and three SVGs, and iOS rasterises an SVG on the main thread
  // the first time it is drawn. Built in the opening commit, five drops put that on the frames of
  // the slide-in, the moment the reported "open a profile, FPS drops by 20" is measured. They now
  // mount once the transition has settled and fade in on the native driver (no glass inside them,
  // so an opacity on this wrapper is safe).
  const fade = useRef(new RNAnimated.Value(0)).current;
  useEffect(() => {
    if (!settled) return;
    RNAnimated.timing(fade, { toValue: 1, duration: 260, easing: RNEasing.out(RNEasing.quad), useNativeDriver: true }).start();
  }, [settled, fade]);

  if (!layout || areaW < 80 || !settled) return null;
  const running = active && !reduceMotion;

  return (
    <RNAnimated.View pointerEvents="box-none" style={{ position: 'absolute', top, left, width: areaW, height, opacity: fade }}>
      {list.map((l, i) => {
        const p = placed[i];
        return (
          <Bubble
            key={`${l.url}-${i}`}
            url={l.url}
            size={p.size}
            left={p.cx - p.size / 2}
            top={p.cy - p.size / 2}
            index={i}
            running={running}
            websiteLabel={t('edit_profile.link_website')}
            centers={centers}
            pops={pops}
            lastPop={lastPop}
            armed={armed}
            onGrab={arm}
          />
        );
      })}
    </RNAnimated.View>
  );
});

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  iconShadow: { textShadowColor: 'rgba(0,0,0,0.3)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
});
