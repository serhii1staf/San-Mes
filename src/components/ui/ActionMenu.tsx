/**
 * The long-press action menu shared by chat messages, comments and profile posts.
 *
 * Telegram's current design, from the mock the owner sent: the held item stays where it is, and a
 * frosted card opens right next to it, under it when there is room, above it when there is not.
 * The card has up to three icon-over-label actions in a row at the top, a hairline, and a plain list
 * of icon + label rows under it.
 *
 * There is no copy of the held item. The previous menus rebuilt the message as a preview card and
 * slid a sheet up from the bottom. Rebuilding the content was most of the cost of opening them (link
 * previews, image grids, formatted text), and the copy never looked exactly like the original.
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
import React, { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { BackHandler, Keyboard, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
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
}

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

function ActionMenuInner<Id extends string>(
  { anchor, align = 'left', title, top, items, onSelect, onWillSelect, onClosing, onClose, zones, hovered, spotlightRadius }: ActionMenuProps<Id>,
  ref: React.ForwardedRef<ActionMenuHandle>,
) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width: W, height: H } = useWindowDimensions();
  const glassActive = useLiquidGlassActive();
  const p = useSharedValue(0);
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
  const keyboardH = Keyboard.isVisible() ? Keyboard.metrics()?.height ?? 0 : 0;
  const minTop = insets.top + 8;
  const maxBottom = H - Math.max(insets.bottom, 10) - 8 - keyboardH;

  let menuTop: number;
  let below = true;
  if (!anchor) {
    menuTop = clamp((H - menuH) / 2, minTop, Math.max(minTop, maxBottom - menuH));
  } else if (anchor.y + anchor.height + GAP + menuH <= maxBottom) {
    menuTop = anchor.y + anchor.height + GAP;
  } else if (anchor.y - GAP - menuH >= minTop) {
    menuTop = anchor.y - GAP - menuH;
    below = false;
  } else {
    // Taller than the free space on either side (a long message): pin to the bottom edge.
    menuTop = Math.max(minTop, maxBottom - menuH);
    below = false;
  }
  const rawLeft = !anchor ? (W - menuW) / 2 : align === 'right' ? anchor.x + anchor.width - menuW : anchor.x;
  const menuLeft = clamp(rawLeft, 12, W - menuW - 12);
  const origin = `${below ? 'top' : 'bottom'} ${align === 'right' && anchor ? 'right' : 'left'}`;

  // ── Open / close ─────────────────────────────────────────────────────────
  useEffect(() => {
    p.value = withSpring(1, OPEN_SPRING);
  }, [p]);

  const finish = useCallback(() => {
    const fn = after.current;
    after.current = null;
    onClose();
    fn?.();
  }, [onClose]);

  const dismiss = useCallback(
    (cb?: () => void) => {
      if (closing.current) return;
      closing.current = true;
      after.current = cb ?? null;
      onClosingRef.current?.();
      c.value = withTiming(1, CLOSE_TIMING, () => {
        runOnJS(finish)();
      });
    },
    [c, finish],
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
    if (!zones) return;
    const t = setTimeout(measureZones, 380);
    return () => clearTimeout(t);
  }, [zones, measureZones]);
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
    const open = p.value;
    const shut = c.value;
    return {
      opacity: surfaceGlass ? 1 : interpolate(open, [0, 0.45], [0, 1], Extrapolation.CLAMP) * (1 - shut),
      transform: [{ scale: interpolate(open, [0, 1], [surfaceGlass ? 0.35 : 0.6, 1]) * (1 - 0.92 * shut) }],
    };
  });
  const dimStyle = useAnimatedStyle(() => ({ opacity: Math.min(1, Math.max(0, p.value)) * (1 - c.value) }));

  // ── The held item stays lit ──────────────────────────────────────────────
  // Everything is dimmed except a rounded cut-out around the held item, so it is obvious what the
  // menu acts on. One SVG path (screen rect + hole, even-odd), drawn once; only its opacity animates.
  const spotlightPath = useMemo(() => {
    if (!anchor || spotlightRadius === undefined) return null;
    const x = anchor.x - SPOT_PAD;
    const y = anchor.y - SPOT_PAD;
    const w = anchor.width + SPOT_PAD * 2;
    const h = anchor.height + SPOT_PAD * 2;
    const r = Math.max(0, Math.min(spotlightRadius + SPOT_PAD, w / 2, h / 2));
    const outer = `M-50 -50H${W + 50}V${H + 400}H-50Z`;
    const hole = `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
    return outer + hole;
  }, [anchor, spotlightRadius, W, H]);

  const isDark = theme.isDark;
  const textColor = theme.colors.text.primary;
  const hoverBg = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)';
  const hairline = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.10)';
  const isIOS = Platform.OS === 'ios';
  // Flat, not a blur view: the card fades, and a UIVisualEffectView under an alpha below 1 renders
  // broken until the alpha is back at 1. The theme's own elevated surface keeps the menu in the theme.
  const flatSurface = isDark ? theme.colors.background.elevated : '#FFFFFF';

  const dimColor = spotlightPath
    ? isDark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.26)'
    : isIOS ? 'rgba(0,0,0,0.10)' : 'rgba(0,0,0,0.32)';

  return (
    <View style={StyleSheet.absoluteFill} accessibilityViewIsModal>
      <Reanimated.View pointerEvents="none" style={[StyleSheet.absoluteFill, dimStyle]}>
        {spotlightPath ? (
          <Svg style={StyleSheet.absoluteFill}>
            <Path d={spotlightPath} fill={dimColor} fillRule="evenodd" />
          </Svg>
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: dimColor }]} />
        )}
      </Reanimated.View>
      <Pressable style={StyleSheet.absoluteFill} onPress={() => dismiss()} accessibilityRole="button" accessibilityLabel="Close" />

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
    </View>
  );
}

export const ActionMenu = forwardRef(ActionMenuInner) as <Id extends string>(
  props: ActionMenuProps<Id> & { ref?: React.Ref<ActionMenuHandle> },
) => React.ReactElement;

const styles = StyleSheet.create({
  card: { position: 'absolute', borderRadius: RADIUS },
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
