/**
 * The long-press action menu shared by chat messages, comments and profile posts.
 *
 * Telegram's current design, from the mock the owner sent: the held item stays where it is, and a
 * frosted card opens right next to it, under it when there is room, above it when there is not.
 * The card has up to three icon-over-label actions in a row at the top, a hairline, and a plain list
 * of icon + label rows under it.
 *
 * The held item is never rebuilt. The previous menus rebuilt the message as a preview card and slid
 * a sheet up from the bottom. Rebuilding the content was most of the cost of opening them (link
 * previews, image grids, formatted text), and the copy never looked exactly like the original. An
 * item that cannot be seen whole where it is gets a snapshot of its own view instead, an image (see
 * "THE WHOLE ITEM, ALWAYS").
 *
 * Surfaces: native liquid glass on iOS 26 with glass enabled, the theme's elevated surface
 * elsewhere. Glass rule of this codebase: no alpha on a glass view or any of its ancestors
 * (expo/expo#41024). So with glass the card opens AND closes by scale only: it grows out of the
 * corner nearest the held item and collapses back into it.
 *
 * With `spotlightRadius`, the backdrop dims everything except a rounded cut-out around the held
 * item, so it is clear what the menu acts on.
 *
 * Optional press-drag-release: `zones` receives each action's window rect once the card has
 * settled, and `hovered` (written by the caller's gesture) highlights the action under the finger.
 */
import React, { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  BackHandler,
  Image,
  Keyboard,
  PixelRatio,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { KeyboardController } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Reanimated, {
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { GlassBg, useLiquidGlassActive } from './LiquidGlass';
import { triggerHaptic } from '../../utils/haptics';

export type ActionMenuIcon =
  | { set: 'feather'; name: React.ComponentProps<typeof Feather>['name'] }
  | { set: 'mci'; name: React.ComponentProps<typeof MaterialCommunityIcons>['name'] };

export interface ActionMenuItem<Id extends string = string> {
  id: Id;
  icon: ActionMenuIcon;
  label: string;
  destructive?: boolean;
}

/** Window-space rect of one action, for a press-drag-release gesture to hit-test. */
export type ActionMenuZone = { id: string; top: number; bottom: number; left?: number; right?: number };

export interface ActionMenuAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ActionMenuHandle {
  /** Animate out, then call `onClose`, then `cb`. */
  dismiss: (cb?: () => void) => void;
}

interface ActionMenuProps<Id extends string> {
  /** Window rect of the held item. `null` centres the card. */
  anchor: ActionMenuAnchor | null;
  /** Which edge of the held item the card lines up with: own messages sit on the right. */
  align?: 'left' | 'right';
  /** Small caption at the top of the card (used by the report-reason step). */
  title?: string;
  /** Up to three actions shown as icon-over-label cells. */
  top?: ActionMenuItem<Id>[];
  items: ActionMenuItem<Id>[];
  /** Runs after the card has animated out (and after `onClose`). */
  onSelect: (id: Id) => void;
  /** Runs at the press itself, before the close animation. */
  onWillSelect?: (id: Id) => void;
  /** Runs when the close animation starts, whatever started it. */
  onClosing?: () => void;
  onClose: () => void;
  zones?: SharedValue<ActionMenuZone[]>;
  hovered?: SharedValue<string>;
  /**
   * Corner radius of the held item. When set (with an anchor), the backdrop dims everything except
   * a rounded cut-out around the item, so the item stays lit and the menu reads as acting on it.
   */
  spotlightRadius?: number;
  /**
   * Window-space band the held item can actually be seen in: below the screen's header, above its
   * composer or tab bar. The cut-out is clipped to it.
   *
   * Reported: holding a message that had scrolled partly under the header (or the input bar) lit up
   * the header's buttons through the hole, because the hole was cut at the item's full rect and the
   * header sits over that part of it. Clipped to the band, the chrome stays dimmed and the hole only
   * covers the part of the item that is on screen; a clipped edge is square, since it is not the
   * item's own edge. Omitted, the whole window counts.
   */
  spotlightBounds?: { top: number; bottom: number };
  /**
   * How much the caller scales the held item while the menu is open (the chat lifts a bubble to
   * 1.04). The cut-out grows by the same amount, so the lifted item's edges are not under the dim.
   */
  spotlightLift?: number;
  /**
   * The held item's view (a ref's current value, or a native tag). With it, an item that cannot be
   * seen whole where it is gets a SNAPSHOT instead (see "THE WHOLE ITEM, ALWAYS" below).
   */
  captureHeld?: () => unknown;
  /**
   * Progress of that snapshot: `planned` on mount when one will be taken (do not lift the item; the
   * keyboard may stay up until it is shown), `shown` once it covers the item (hide the item, dismiss
   * the keyboard), `failed` when it could not be taken (back to the lit cut-out), `gone` when the
   * close starts (show the item again).
   */
  onHeldPreview?: (state: 'planned' | 'shown' | 'failed' | 'gone') => void;
}

// ── THE WHOLE ITEM, ALWAYS ───────────────────────────────────────────────────────────────────────
//
// Asked for, as "very important": whatever is held must be captured whole and correctly, even when
// part of it is not on screen. The lit cut-out only lights what is visible where the item is, so a
// message taller than the space between the header and the composer showed a slice of itself with
// the card pinned over it, and one half under the header showed half. And when the keyboard was up,
// dismissing it moved the list while the cut-out stayed, so the hole and the bubble parted ways.
//
// So when the item is not wholly visible, does not leave room for the card beside it, or the
// keyboard is up, the menu takes a snapshot of the item's own view (react-native-view-shot: the
// whole view, the parts off screen included, at up to `MAX_SHOT_PIXELS`) and shows that: from
// exactly where the item was, it moves to the top of the free space, the card goes under it, and a
// snapshot taller than the space scrolls, starting at the part that was on screen. The live item is
// hidden meanwhile and comes back as the menu closes. Everything else keeps the cut-out, which costs
// nothing to show.
type ViewShot = typeof import('react-native-view-shot');
let viewShotMod: ViewShot | null | undefined;
/** Required on first use, not imported: the menu must not fail to load if a binary lacked it. */
function viewShot(): ViewShot | null {
  if (viewShotMod === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      viewShotMod = require('react-native-view-shot') as ViewShot;
    } catch {
      viewShotMod = null;
    }
  }
  return viewShotMod;
}
/**
 * The keyboard's height now, 0 when it is down. React Native's `Keyboard.metrics()` alone is not
 * enough: on Android, in the chat's adjust-nothing window, it reported the keyboard visible with a
 * height of 0 (emulator, Nov 2026) while keyboard-controller, which the app runs at its root, had the
 * real 222 pt. So the menu never saw the keyboard there, took no snapshot, and could put the card
 * under it. The larger of the two.
 */
function keyboardHeightNow(): number {
  let h = Keyboard.isVisible() ? Keyboard.metrics()?.height ?? 0 : 0;
  try {
    if (KeyboardController.isVisible()) h = Math.max(h, KeyboardController.state()?.height ?? 0);
  } catch {}
  return h;
}
const MAX_SHOT_PIXELS = 4_000_000;
// Longest side of the snapshot, in pixels: what every GPU can hold as one texture. Android before 9
// draws nothing for a bitmap past its texture limit (4096 on many of those devices); later ones tile.
const MAX_SHOT_SIDE = Platform.OS === 'android' && (Platform.Version as number) < 28 ? 4096 : 8192;
/** How long the card waits for the snapshot before it opens without it (keyboard down; see the open effect). */
const CARD_WAIT_MS = 300;
// A snapshot that has not arrived and loaded by then is given up on, and the menu keeps the cut-out.
// Generous on purpose: the cut-out shows the item meanwhile, and a long message is slow to snapshot.
// Measured on the emulator for a 4,790 pt message (4 M px): 500 ms to draw and encode, 750 ms with
// the menu opening, about 1 s until the image is decoded and shown.
const SHOT_TIMEOUT_MS = 4000;
// iOS draws the snapshot on the main thread, which also runs the card's open spring, so a big one
// waits until the card has opened rather than stall it. A small one (most bubbles) is cheap enough
// to take at once, and so is any one with the keyboard up: the card and the keyboard both wait for
// it then (see the open effect), so a delay would only add to the wait. Android draws it on a
// worker thread (view-shot 4.0.3 runs the capture on an executor).
const SHOT_DELAY_MS = Platform.OS === 'ios' ? 320 : 0;
const SHOT_DELAY_PIXELS = 1_000_000;

type PreviewPlan = {
  left: number;
  width: number;
  /** The item's full height, and the height of the window it is shown in (smaller: it scrolls). */
  fullHeight: number;
  height: number;
  top: number;
  /** Where the window's content starts, and the shift at which the snapshot covers the item. */
  scroll: number;
  startShift: number;
  menuTop: number;
  /** The keyboard was up: dismissing it moves the item, so the snapshot does not return to it. */
  keyboardUp: boolean;
};

export const MENU_WIDTH = 254;
const TOP_ROW_H = 72;
const ROW_H = 46;
const LIST_PAD = 6;
const SEPARATOR_H = 1;
const TITLE_H = 34;
const GAP = 10;
const RADIUS = 24;
const IOS_RED = '#FF3B30';

const OPEN_SPRING = { damping: 19, stiffness: 300, mass: 0.75 };
// The snapshot moving from where the item was into its place: settles without overshoot. And back,
// as the menu closes: most of the way early, so it fades out over the item rather than beside it.
const PREVIEW_SPRING = { damping: 24, stiffness: 260, mass: 0.8 };
const PREVIEW_RETURN = { duration: 230, easing: Easing.out(Easing.cubic) };
// Unless the keyboard was dismissed, which moved the item: the snapshot has nothing to go back to,
// and faded with the card it stayed whole for the first 100 ms beside the item it copies, which
// showed both (emulator). So it fades at once instead.
const PREVIEW_FADE = { duration: 140, easing: Easing.out(Easing.quad) };
// The open run backwards: the card collapses into the corner it grew out of, accelerating as it
// goes, so it ends small and fast instead of vanishing at full size.
const CLOSE_TIMING = { duration: 230, easing: Easing.bezier(0.55, 0, 0.75, 0.2) };
// Gap between the held item and the edge of its cut-out in the dim.
const SPOT_PAD = 6;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function MenuIcon({ icon, color, size }: { icon: ActionMenuIcon; color: string; size: number }) {
  return icon.set === 'feather'
    ? <Feather name={icon.name} size={size} color={color} />
    : <MaterialCommunityIcons name={icon.name} size={size + 2} color={color} />;
}

const TopCell = memo(function TopCell<Id extends string>({
  item, color, hoverBg, hovered, onPress, registerRef, index,
}: {
  item: ActionMenuItem<Id>;
  color: string;
  hoverBg: string;
  hovered?: SharedValue<string>;
  onPress: (id: Id) => void;
  registerRef: (index: number, node: View | null) => void;
  index: number;
}) {
  const hoverStyle = useAnimatedStyle(() => ({
    backgroundColor: hovered && hovered.value === item.id ? hoverBg : 'transparent',
  }));
  return (
    <Reanimated.View style={[styles.topCellWrap, hoverStyle]}>
      <Pressable
        ref={(n) => registerRef(index, n)}
        onPress={() => onPress(item.id)}
        accessibilityRole="button"
        accessibilityLabel={item.label}
        style={({ pressed }) => [styles.topCell, pressed ? { backgroundColor: hoverBg } : null]}
      >
        <MenuIcon icon={item.icon} color={color} size={21} />
        <Text variant="caption" weight="medium" color={color} numberOfLines={1} style={styles.topLabel}>
          {item.label}
        </Text>
      </Pressable>
    </Reanimated.View>
  );
}) as <Id extends string>(p: {
  item: ActionMenuItem<Id>;
  color: string;
  hoverBg: string;
  hovered?: SharedValue<string>;
  onPress: (id: Id) => void;
  registerRef: (index: number, node: View | null) => void;
  index: number;
}) => React.ReactElement;

const ListRow = memo(function ListRow<Id extends string>({
  item, color, hoverBg, hovered, onPress, registerRef, index,
}: {
  item: ActionMenuItem<Id>;
  color: string;
  hoverBg: string;
  hovered?: SharedValue<string>;
  onPress: (id: Id) => void;
  registerRef: (index: number, node: View | null) => void;
  index: number;
}) {
  const hoverStyle = useAnimatedStyle(() => ({
    backgroundColor: hovered && hovered.value === item.id ? hoverBg : 'transparent',
  }));
  return (
    <Reanimated.View style={hoverStyle}>
      <Pressable
        ref={(n) => registerRef(index, n)}
        onPress={() => onPress(item.id)}
        accessibilityRole="button"
        accessibilityLabel={item.label}
        style={({ pressed }) => [styles.row, pressed ? { backgroundColor: hoverBg } : null]}
      >
        <View style={styles.rowIcon}>
          <MenuIcon icon={item.icon} color={color} size={20} />
        </View>
        <Text variant="body" color={color} numberOfLines={1} style={styles.rowLabel}>
          {item.label}
        </Text>
      </Pressable>
    </Reanimated.View>
  );
}) as <Id extends string>(p: {
  item: ActionMenuItem<Id>;
  color: string;
  hoverBg: string;
  hovered?: SharedValue<string>;
  onPress: (id: Id) => void;
  registerRef: (index: number, node: View | null) => void;
  index: number;
}) => React.ReactElement;

const NO_ITEMS: never[] = [];

/** The lit cut-out: a rect, its top corners rounded by `rt` and its bottom ones by `rb` (0: square). */
type SpotHole = { x: number; w: number; y0: number; y1: number; rt: number; rb: number };

// The dim with the cut-out in it, as plain views: four bands around the cut-out, and at each
// rounded edge a strip that shows the dim outside the corner arcs (see `CornerStrip`).
//
// It was one SVG path (screen rect + hole, even-odd). On Android react-native-svg rasterises that in
// software into a bitmap the size of the screen and uploads it as a texture: traced on the emulator,
// the frame the menu opened in spent 71 ms drawing views and 66 ms uploading that 1080x1920 texture,
// and the same again when a snapshot replaced the cut-out. Views are drawn by the GPU as they are.
const SpotlightDim = memo(function SpotlightDim({ hole, color, W, H }: { hole: SpotHole; color: string; W: number; H: number }) {
  const { x, w, y0, y1, rt, rb } = hole;
  const bg = { backgroundColor: color };
  return (
    <>
      <View style={[styles.dimBand, bg, { left: -50, top: -50, width: W + 100, height: Math.max(0, y0 + 50) }]} />
      <View style={[styles.dimBand, bg, { left: -50, top: y1, width: W + 100, height: Math.max(0, H + 400 - y1) }]} />
      <View style={[styles.dimBand, bg, { left: -50, top: y0, width: Math.max(0, x + 50), height: y1 - y0 }]} />
      <View style={[styles.dimBand, bg, { left: x + w, top: y0, width: Math.max(0, W + 50 - x - w), height: y1 - y0 }]} />
      {rt > 0 ? <CornerStrip left={x} top={y0} width={w} radius={rt} edge="top" color={color} /> : null}
      {rb > 0 ? <CornerStrip left={x} top={y1 - rb} width={w} radius={rb} edge="bottom" color={color} /> : null}
    </>
  );
});

// A strip as tall as the radius along the top or bottom edge of the cut-out. Inside it, a frame: a
// view with a border thicker than the radius and a corner radius of radius + border, so the inner
// edge of its border is the cut-out's own rounded edge. The strip clips the frame, and what is left
// is the dim outside the two corner arcs. One radius on all four corners of the frame: iOS draws a
// uniform border with Core Animation (for a view that clips), and anything else as a bitmap.
function CornerStrip({ left, top, width, radius, edge, color }: {
  left: number; top: number; width: number; radius: number; edge: 'top' | 'bottom'; color: string;
}) {
  const b = Math.ceil(radius) + 2;
  return (
    <View style={[styles.cornerStrip, { left, top, width, height: radius }]}>
      <View
        style={[
          styles.cornerFrame,
          {
            left: -b,
            top: edge === 'top' ? -b : -radius - b,
            width: width + b * 2,
            height: radius * 2 + b * 2,
            borderWidth: b,
            borderRadius: radius + b,
            borderColor: color,
          },
        ]}
      />
    </View>
  );
}

function ActionMenuInner<Id extends string>(
  {
    anchor, align = 'left', title, top, items, onSelect, onWillSelect, onClosing, onClose, zones, hovered,
    spotlightRadius, spotlightBounds, spotlightLift = 1, captureHeld, onHeldPreview,
  }: ActionMenuProps<Id>,
  ref: React.ForwardedRef<ActionMenuHandle>,
) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width: W, height: H } = useWindowDimensions();
  const glassActive = useLiquidGlassActive();
  const p = useSharedValue(0);
  const cp = useSharedValue(0);
  const c = useSharedValue(0);
  const closing = useRef(false);
  const after = useRef<(() => void) | null>(null);
  const onClosingRef = useRef(onClosing);
  useEffect(() => {
    onClosingRef.current = onClosing;
  }, [onClosing]);

  // ── Geometry ──────────────────────────────────────────────────────────────
  // Memoized so a parent re-render (the chat re-renders on typing, new messages) does not rebuild
  // the zone measurement and restart its timer before it has fired.
  const topList = top ?? NO_ITEMS;
  const topCells = useMemo(() => topList.slice(0, 3), [topList]);
  const menuW = Math.min(MENU_WIDTH, W - 24);
  const menuH =
    (title ? TITLE_H : 0) +
    (topCells.length > 0 ? TOP_ROW_H : 0) +
    (topCells.length > 0 && items.length > 0 ? SEPARATOR_H : 0) +
    (items.length > 0 ? items.length * ROW_H + LIST_PAD * 2 : 0);
  const keyboardH = keyboardHeightNow();
  const minTop = insets.top + 8;
  const maxBottom = H - Math.max(insets.bottom, 10) - 8 - keyboardH;

  // Decided once, on mount, from the item's rect: the parent hands a new anchor object on every
  // render, and the plan must not change under an open menu. See "THE WHOLE ITEM, ALWAYS".
  const [plan] = useState<PreviewPlan | null>(() => {
    if (!captureHeld || !anchor || anchor.width < 1 || anchor.height < 1) return null;
    const bandTop = spotlightBounds?.top ?? minTop;
    const bandBottom = spotlightBounds?.bottom ?? maxBottom;
    const whollyVisible = anchor.y >= bandTop - 1 && anchor.y + anchor.height <= bandBottom + 1;
    const fitsBeside = anchor.y + anchor.height + GAP + menuH <= maxBottom || anchor.y - GAP - menuH >= minTop;
    if (whollyVisible && fitsBeside && keyboardH === 0) return null;
    // The keyboard is dismissed once the snapshot is up, so the free space is the whole screen.
    const freeBottom = H - Math.max(insets.bottom, 10) - 8;
    const height = Math.min(anchor.height, Math.max(80, freeBottom - minTop - GAP - menuH));
    const topY = clamp(anchor.y, minTop, Math.max(minTop, freeBottom - GAP - menuH - height));
    const scroll = clamp(topY - anchor.y, 0, anchor.height - height);
    return {
      left: anchor.x,
      width: anchor.width,
      fullHeight: anchor.height,
      height,
      top: topY,
      scroll,
      startShift: anchor.y + scroll - topY,
      menuTop: topY + height + GAP,
      keyboardUp: keyboardH > 0,
    };
  });

  let menuTop: number;
  let below = true;
  // The lifted item grows about its centre, so the card keeps its gap from the grown edge.
  const liftPad = anchor ? (anchor.height * (spotlightLift - 1)) / 2 : 0;
  if (plan) {
    menuTop = plan.menuTop;
  } else if (!anchor) {
    menuTop = clamp((H - menuH) / 2, minTop, Math.max(minTop, maxBottom - menuH));
  } else if (anchor.y + anchor.height + liftPad + GAP + menuH <= maxBottom) {
    menuTop = anchor.y + anchor.height + liftPad + GAP;
  } else if (anchor.y - liftPad - GAP - menuH >= minTop) {
    menuTop = anchor.y - liftPad - GAP - menuH;
    below = false;
  } else {
    // Taller than the free space on either side and no snapshot to show instead: pin to the bottom.
    menuTop = Math.max(minTop, maxBottom - menuH);
    below = false;
  }
  const rawLeft = !anchor ? (W - menuW) / 2 : align === 'right' ? anchor.x + anchor.width - menuW : anchor.x;
  const menuLeft = clamp(rawLeft, 12, W - menuW - 12);
  const origin = `${below ? 'top' : 'bottom'} ${align === 'right' && anchor ? 'right' : 'left'}`;

  // ── Open / close ─────────────────────────────────────────────────────────
  // `p` is the dim, `cp` the card. They open together, except when a snapshot is taken: then the card
  // opens with the snapshot (it rises into place as the card grows under it), or after
  // `CARD_WAIT_MS` without it, rather than open over the item first and be crossed by it.
  // With the keyboard up it waits for the snapshot (or its failure) however long that takes: its
  // place is where the keyboard is until the snapshot is shown and the keyboard goes, and opened
  // early only its top row showed above the keyboard (a long message, emulator, about 0.8 s).
  const [cardOpen, setCardOpen] = useState(!plan);
  const cardStarted = useRef(!plan);
  const startCard = useCallback(() => {
    // Not once the close has begun: a card that never opened stays shut rather than flash open.
    if (cardStarted.current || closing.current) return;
    cardStarted.current = true;
    setCardOpen(true);
  }, []);
  useEffect(() => {
    p.value = withSpring(1, OPEN_SPRING);
    if (!plan || plan.keyboardUp) return;
    const t = setTimeout(startCard, CARD_WAIT_MS);
    return () => clearTimeout(t);
  }, [p, plan, startCard]);
  // After the commit that mounts it: a glass card waiting for the snapshot is not mounted (see below),
  // and a spring started before the mount would spend its first frames on nothing.
  useEffect(() => {
    if (cardOpen) cp.value = withSpring(1, OPEN_SPRING);
  }, [cardOpen, cp]);

  const finish = useCallback(() => {
    const fn = after.current;
    after.current = null;
    onClose();
    fn?.();
  }, [onClose]);

  // ── The snapshot (see "THE WHOLE ITEM, ALWAYS") ─────────────────────────────
  const [shot, setShot] = useState<string | null>(null);
  const [shotShown, setShotShown] = useState(false);
  const shotSettled = useRef(false);
  const onHeldPreviewRef = useRef(onHeldPreview);
  useEffect(() => {
    onHeldPreviewRef.current = onHeldPreview;
  }, [onHeldPreview]);
  const captureHeldRef = useRef(captureHeld);
  const shift = useSharedValue(plan ? plan.startShift : 0);
  const fade = useSharedValue(1);
  const shotTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewScroll = useRef<ScrollView>(null);
  const shownRef = useRef(false);

  useEffect(() => {
    if (!plan) return;
    onHeldPreviewRef.current?.('planned');
    let cancelled = false;
    const fail = () => {
      if (cancelled || shotSettled.current) return;
      shotSettled.current = true;
      onHeldPreviewRef.current?.('failed');
      startCard();
    };
    // Released at once when it is no longer wanted; the one shown is released on unmount.
    const release = (uri: string) => {
      try {
        viewShot()?.releaseCapture(uri);
      } catch {}
    };
    // Scaled down only past the caps. view-shot takes the size in pixels on Android and in points on
    // iOS (rendered at the screen's scale), and without one captures the view at its own size.
    const density = PixelRatio.get();
    const fullPixels = plan.width * plan.fullHeight * density * density;
    const fit = Math.min(
      1,
      Math.sqrt(MAX_SHOT_PIXELS / fullPixels),
      MAX_SHOT_SIDE / (plan.fullHeight * density),
      MAX_SHOT_SIDE / (plan.width * density),
    );
    const unit = Platform.OS === 'android' ? density : 1;
    const take = () => {
      if (cancelled || shotSettled.current) return;
      try {
        const target = captureHeldRef.current?.();
        const captureRef = viewShot()?.captureRef;
        if (!target || !captureRef) throw new Error('nothing to capture');
        captureRef(target as number, {
          format: 'png',
          result: 'tmpfile',
          ...(fit < 1
            ? { width: Math.max(1, Math.round(plan.width * fit * unit)), height: Math.max(1, Math.round(plan.fullHeight * fit * unit)) }
            : null),
        }).then((uri) => {
          if (!cancelled && !shotSettled.current) setShot(uri);
          else release(uri);
        }, fail);
      } catch {
        fail();
      }
    };
    const delayMs = !plan.keyboardUp && fullPixels * fit * fit > SHOT_DELAY_PIXELS ? SHOT_DELAY_MS : 0;
    shotTimer.current = setTimeout(fail, delayMs + SHOT_TIMEOUT_MS);
    const delay = delayMs > 0 ? setTimeout(take, delayMs) : null;
    if (!delay) take();
    return () => {
      cancelled = true;
      if (shotTimer.current) clearTimeout(shotTimer.current);
      if (delay) clearTimeout(delay);
    };
    // Once per menu: the plan is fixed at mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The snapshot is drawn over the item first; the item is hidden a frame later, so there is never a
  // frame with neither on screen. Then it moves into its place.
  const onShotLoaded = useCallback(() => {
    if (shotSettled.current || closing.current) return;
    shotSettled.current = true;
    shownRef.current = true;
    if (shotTimer.current) clearTimeout(shotTimer.current);
    setShotShown(true);
    requestAnimationFrame(() => {
      onHeldPreviewRef.current?.('shown');
      shift.value = withSpring(0, PREVIEW_SPRING);
      startCard();
    });
  }, [shift, startCard]);
  const onShotError = useCallback(() => {
    if (shotSettled.current) return;
    shotSettled.current = true;
    if (shotTimer.current) clearTimeout(shotTimer.current);
    onHeldPreviewRef.current?.('failed');
    startCard();
  }, [startCard]);

  useEffect(() => () => {
    if (!shot) return;
    try {
      viewShot()?.releaseCapture(shot);
    } catch {}
  }, [shot]);

  const dismiss = useCallback(
    (cb?: () => void) => {
      if (closing.current) return;
      closing.current = true;
      after.current = cb ?? null;
      onClosingRef.current?.();
      // The live item comes back at once, and the snapshot fades with the card while it goes back
      // over it, scrolled back to the part that was on screen. Unless the keyboard was dismissed:
      // that moved the item, so the snapshot fades where it is, quickly (`PREVIEW_FADE`).
      if (plan) {
        shotSettled.current = true;
        onHeldPreviewRef.current?.('gone');
        if (shownRef.current && !plan.keyboardUp) {
          shift.value = withTiming(plan.startShift, PREVIEW_RETURN);
          if (plan.height < plan.fullHeight) previewScroll.current?.scrollTo({ y: plan.scroll, animated: true });
        } else if (shownRef.current) {
          fade.value = withTiming(0, PREVIEW_FADE);
        }
      }
      c.value = withTiming(1, CLOSE_TIMING, () => {
        runOnJS(finish)();
      });
    },
    [c, fade, finish, plan, shift],
  );
  useImperativeHandle(ref, () => ({ dismiss }), [dismiss]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      dismiss();
      return true;
    });
    return () => sub.remove();
  }, [dismiss]);

  const onSelectRef = useRef(onSelect);
  const onWillSelectRef = useRef(onWillSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
    onWillSelectRef.current = onWillSelect;
  }, [onSelect, onWillSelect]);
  const select = useCallback((id: Id) => {
    if (closing.current) return;
    triggerHaptic('selection');
    onWillSelectRef.current?.(id);
    dismiss(() => onSelectRef.current(id));
  }, [dismiss]);

  // ── Drag zones ───────────────────────────────────────────────────────────
  const nodes = useRef<(View | null)[]>([]);
  const registerRef = useCallback((index: number, node: View | null) => {
    nodes.current[index] = node;
  }, []);
  const ids = useMemo(() => [...topCells.map((a) => a.id), ...items.map((a) => a.id)], [topCells, items]);
  const measureZones = useCallback(() => {
    if (!zones) return;
    const out: (ActionMenuZone | undefined)[] = new Array(ids.length);
    let remaining = ids.length;
    if (remaining === 0) {
      zones.value = [];
      return;
    }
    const done = () => {
      remaining -= 1;
      if (remaining <= 0) zones.value = out.filter(Boolean) as ActionMenuZone[];
    };
    ids.forEach((id, i) => {
      const node = nodes.current[i];
      if (!node) {
        done();
        return;
      }
      node.measureInWindow((x, y, w, h) => {
        out[i] = i < topCells.length ? { id, top: y, bottom: y + h, left: x, right: x + w } : { id, top: y, bottom: y + h };
        done();
      });
    });
  }, [zones, ids, topCells.length]);
  // The card animates in by scale, so the rects are only final once the spring has settled.
  useEffect(() => {
    if (!zones || !cardOpen) return;
    const t = setTimeout(measureZones, 380);
    return () => clearTimeout(t);
  }, [zones, measureZones, cardOpen]);
  useEffect(
    () => () => {
      if (zones) zones.value = [];
      if (hovered) hovered.value = '';
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // ── Styles ───────────────────────────────────────────────────────────────
  // Glass keeps its glass for the whole close as well: it shrinks back into its corner by scale
  // alone, which is the open played backwards. (It used to switch to a flat surface and fade, and the
  // swap from glass to flat at the start of the close was the "strange" close.) An alpha on a glass
  // view or its ancestor switches its glass off (expo/expo#41024), so glass never fades.
  const surfaceGlass = glassActive;
  const cardStyle = useAnimatedStyle(() => {
    const open = cp.value;
    const shut = c.value;
    return {
      opacity: surfaceGlass ? 1 : interpolate(open, [0, 0.45], [0, 1], Extrapolation.CLAMP) * (1 - shut),
      transform: [{ scale: interpolate(open, [0, 1], [surfaceGlass ? 0.35 : 0.6, 1]) * (1 - 0.92 * shut) }],
    };
  });
  const dimStyle = useAnimatedStyle(() => ({ opacity: Math.min(1, Math.max(0, p.value)) * (1 - c.value) }));

  // ── The held item stays lit ──────────────────────────────────────────────
  // Everything is dimmed except a rounded cut-out around the held item, so it is obvious what the
  // menu acts on. Drawn once (see `SpotlightDim`); only its opacity animates. `'all'`: dim it all.
  const boundsTop = spotlightBounds?.top;
  const boundsBottom = spotlightBounds?.bottom;
  const spotHole = useMemo((): SpotHole | 'all' | null => {
    if (!anchor || spotlightRadius === undefined) return null;
    // The snapshot is above the dim: nothing of the list needs to show through.
    if (shotShown) return 'all';
    // The lifted item grows about its centre; the hole grows with it.
    const growX = (anchor.width * (spotlightLift - 1)) / 2;
    const growY = (anchor.height * (spotlightLift - 1)) / 2;
    const x = anchor.x - SPOT_PAD - growX;
    const w = anchor.width + (SPOT_PAD + growX) * 2;
    const rawTop = anchor.y - SPOT_PAD - growY;
    const rawBottom = anchor.y + anchor.height + SPOT_PAD + growY;
    // Clip to the band the item is visible in; see `spotlightBounds`.
    const y0 = Math.max(rawTop, boundsTop ?? -Infinity);
    const y1 = Math.min(rawBottom, boundsBottom ?? Infinity);
    // Next to nothing of it is on screen: dim everything rather than cut a sliver.
    if (y1 - y0 < 8) return 'all';
    const r = Math.max(0, Math.min(spotlightRadius + SPOT_PAD, w / 2, (y1 - y0) / 2));
    // A clipped edge is the header's or the composer's edge, not the item's: square it.
    return { x, w, y0, y1, rt: y0 > rawTop ? 0 : r, rb: y1 < rawBottom ? 0 : r };
  }, [anchor, spotlightRadius, spotlightLift, shotShown, boundsTop, boundsBottom]);

  const previewStyle = useAnimatedStyle(() => ({
    opacity: Math.min(fade.value, 1 - c.value),
    transform: [{ translateY: shift.value }],
  }));

  const isDark = theme.isDark;
  const textColor = theme.colors.text.primary;
  const hoverBg = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)';
  const hairline = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.10)';
  const isIOS = Platform.OS === 'ios';
  // Flat, not a blur view: the card fades, and a UIVisualEffectView under an alpha below 1 renders
  // broken until the alpha is back at 1. The theme's own elevated surface keeps the menu in the theme.
  const flatSurface = isDark ? theme.colors.background.elevated : '#FFFFFF';

  const dimColor = spotHole
    ? isDark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.26)'
    : isIOS ? 'rgba(0,0,0,0.10)' : 'rgba(0,0,0,0.32)';

  return (
    <View style={StyleSheet.absoluteFill} accessibilityViewIsModal>
      <Reanimated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.dimClip, dimStyle]}>
        {spotHole && spotHole !== 'all' ? (
          <SpotlightDim hole={spotHole} color={dimColor} W={W} H={H} />
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: dimColor }]} />
        )}
      </Reanimated.View>
      <Pressable style={StyleSheet.absoluteFill} onPress={() => dismiss()} accessibilityRole="button" accessibilityLabel="Close" />

      {/* A card waiting for the snapshot (`cp` at 0) is invisible by its alpha. Glass has none to
          spare (it never fades, see above) and would sit there small, so it mounts as it opens. */}
      {cardOpen || !surfaceGlass ? (
        <Reanimated.View
          style={[
            styles.card,
            { top: menuTop, left: menuLeft, width: menuW, height: menuH, transformOrigin: origin },
            surfaceGlass ? null : styles.cardShadow,
            cardStyle,
          ]}
        >
          <View style={[styles.cardClip, surfaceGlass ? styles.unclipped : null]}>
            {surfaceGlass ? (
              <GlassBg borderRadius={RADIUS} glassStyle="regular" interactive={false} colorScheme={isDark ? 'dark' : 'light'} />
            ) : (
              <View style={[StyleSheet.absoluteFill, { backgroundColor: flatSurface }]} />
            )}

            {title ? (
              <View style={styles.title}>
                <Text variant="caption" weight="semibold" color={theme.colors.text.secondary} numberOfLines={1}>{title}</Text>
              </View>
            ) : null}

            {topCells.length > 0 ? (
              <View style={styles.topRow}>
                {topCells.map((item, i) => (
                  <TopCell
                    key={item.id}
                    item={item}
                    index={i}
                    color={item.destructive ? IOS_RED : textColor}
                    hoverBg={hoverBg}
                    hovered={hovered}
                    onPress={select}
                    registerRef={registerRef}
                  />
                ))}
              </View>
            ) : null}
            {topCells.length > 0 && items.length > 0 ? <View style={[styles.separator, { backgroundColor: hairline }]} /> : null}
            {items.length > 0 ? (
              <View style={styles.list}>
                {items.map((item, i) => (
                  <ListRow
                    key={item.id}
                    item={item}
                    index={topCells.length + i}
                    color={item.destructive ? IOS_RED : textColor}
                    hoverBg={hoverBg}
                    hovered={hovered}
                    onPress={select}
                    registerRef={registerRef}
                  />
                ))}
              </View>
            ) : null}
          </View>
        </Reanimated.View>
      ) : null}

      {/* Above the card: on its way into place the snapshot rises over the card's corner. */}
      {plan && shot ? (
        <Reanimated.View
          style={[styles.preview, { left: plan.left, top: plan.top, width: plan.width, height: plan.height }, previewStyle]}
        >
          {/* Invisible until the image has loaded, so nothing shows before it covers the item. A
              window that scrolls cuts the item across: its corners are rounded like the item's. */}
          <View
            style={[
              styles.previewInner,
              plan.height < plan.fullHeight ? { borderRadius: spotlightRadius ?? 0, overflow: 'hidden' } : null,
              shotShown ? null : styles.previewLoading,
            ]}
          >
            <ScrollView
              ref={previewScroll}
              scrollEnabled={plan.height < plan.fullHeight}
              contentOffset={{ x: 0, y: plan.scroll }}
              showsVerticalScrollIndicator={plan.height < plan.fullHeight}
              bounces={false}
              overScrollMode="never"
            >
              {/* `none`: Android (Fresco) otherwise decodes a local file at most 2048 px on its long
                  side, and the text of a long message came out as blocks; the caps above keep the
                  full decode small. `stretch`: the pixel size is rounded, so the aspect can differ
                  from the view's by a fraction, and nothing is cropped for it. */}
              <Image
                source={{ uri: shot }}
                style={{ width: plan.width, height: plan.fullHeight }}
                resizeMethod="none"
                resizeMode="stretch"
                fadeDuration={0}
                onLoad={onShotLoaded}
                onError={onShotError}
                accessibilityIgnoresInvertColors
              />
            </ScrollView>
          </View>
        </Reanimated.View>
      ) : null}
    </View>
  );
}

export const ActionMenu = forwardRef(ActionMenuInner) as <Id extends string>(
  props: ActionMenuProps<Id> & { ref?: React.Ref<ActionMenuHandle> },
) => React.ReactElement;

const styles = StyleSheet.create({
  card: { position: 'absolute', borderRadius: RADIUS },
  // The bands reach past the screen's edges; clipped, as the SVG they replace was.
  dimClip: { overflow: 'hidden' },
  dimBand: { position: 'absolute' },
  cornerStrip: { position: 'absolute', overflow: 'hidden' },
  cornerFrame: { position: 'absolute', overflow: 'hidden' },
  preview: { position: 'absolute' },
  previewInner: { flex: 1 },
  previewLoading: { opacity: 0 },
  // Shadow on the outer view, clipping on the inner one: iOS drops a layer's shadow when the same
  // layer clips its bounds.
  cardShadow: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.22,
    shadowRadius: 26,
    elevation: 14,
  },
  cardClip: { flex: 1, borderRadius: RADIUS, overflow: 'hidden' },
  unclipped: { overflow: 'visible' },
  title: { height: TITLE_H, justifyContent: 'flex-end', paddingHorizontal: 18, paddingBottom: 4 },
  topRow: { height: TOP_ROW_H, flexDirection: 'row', paddingHorizontal: 6, paddingTop: 6 },
  topCellWrap: { flex: 1, borderRadius: 16 },
  topCell: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 16, paddingBottom: 4 },
  topLabel: { fontSize: 12.5 },
  separator: { height: SEPARATOR_H, marginHorizontal: 16 },
  list: { paddingVertical: LIST_PAD },
  row: { height: ROW_H, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18 },
  rowIcon: { width: 24, alignItems: 'center', marginRight: 14 },
  rowLabel: { flex: 1, fontSize: 16.5 },
});
