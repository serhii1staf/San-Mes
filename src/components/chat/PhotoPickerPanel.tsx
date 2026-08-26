import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Pressable, StyleSheet, Dimensions, ActivityIndicator, Text as RNText } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  runOnJS,
  interpolate,
  Extrapolation,
  Easing,
} from 'react-native-reanimated';
import { Image } from 'expo-image';
import { useLiquidGlassActive, GlassBg, NativeGlassView } from '../ui/LiquidGlass';

/**
 * PhotoPickerPanel — the app's own gallery picker, docked in the keyboard's space.
 *
 * ── WHY REPLACE THE OS SHEET ──────────────────────────────────────────────────
 * `ImagePicker.launchImageLibraryAsync` presents a full-screen system modal. It
 * cannot be styled, it covers the transcript, it dismisses the keyboard and its
 * appearance never matches the app (no glass, no theme, no chat background). This
 * panel is the same surface as the emoji / GIF panels — same corner radius, same
 * glass treatment, same docking behaviour — so attaching a photo stays inside the
 * conversation.
 *
 * ── EXPANSION ─────────────────────────────────────────────────────────────────
 * Dragging the grabber grows the panel from its collapsed (keyboard-sized) height
 * to `EXPANDED_RATIO` of the screen and back; dragging well past the collapsed
 * stop closes it. The height is animated on the UI thread from a shared value, so
 * the drag tracks the finger without a JS round-trip per frame.
 *
 * We animate HEIGHT rather than fading anything: a glass surface with `opacity: 0`
 * anywhere in its parent chain loses its glass entirely (expo/expo#41024), so
 * every show/hide in this app is a translate or a size change.
 *
 * ── NATIVE MODULE / COMPLIANCE ────────────────────────────────────────────────
 * Reads the library through `expo-media-library`, which is ALREADY a dependency
 * (used for saving post screenshots), so this ships over-the-air without a new
 * native permission — `NSPhotoLibraryUsageDescription` is already declared and
 * honestly describes this use. Permission is requested at the moment the user taps
 * the attach button, and a denial is respected: the panel then offers the system
 * picker, which works with no library permission at all because iOS hands back
 * only what the user explicitly selects.
 *
 * ── WHY IT DOES NOT PRE-RESIZE ────────────────────────────────────────────────
 * Selected assets are resolved to local file URIs and handed to the caller as-is.
 * The chat screen already owns the downscale/compress step (and the dimension
 * cache that stops the optimistic bubble from jumping), so duplicating it here
 * would mean two places to keep in step and, worse, two decodes per photo.
 */

const SCREEN_H = Dimensions.get('window').height;
const SCREEN_W = Dimensions.get('window').width;

/** How tall the panel can get, as a fraction of the screen. */
const EXPANDED_RATIO = 0.86;
/** Drag past the collapsed height by this much (downward) and the panel closes. */
const CLOSE_DRAG = 90;
/**
 * ── FLOATING AT THE COLLAPSED STOP ────────────────────────────────────────────
 *
 * Requested: the attach panel should come up from the bottom NOT touching any screen edge, and
 * dragging it up should expand it until it does.
 *
 * The panel already had the drag and the two stops. What it did not have is the float — it was
 * docked, full width, flush against the bottom and both sides, so it read as part of the screen
 * rather than as a sheet lifted onto it.
 *
 * ── WHY THE SIDES ARE A SCALE AND THE BOTTOM IS AN OFFSET ─────────────────────
 *
 * These have to be done by different means, and the asymmetry is forced by the grid.
 *
 *   SIDES. `CELL_SIZE` is a module constant, `floor((SCREEN_W - gaps) / COLUMNS)`. Narrowing the
 *   container therefore does NOT re-flow the grid to fit — the cells keep their computed width and
 *   the third column is simply clipped by `overflow: hidden`. So the horizontal inset cannot be a
 *   width change. A uniform `scale` about `bottom center` produces the same gap with layout
 *   untouched, which is also the only option consistent with this file's whole design (see the note
 *   on `panelStyle`: nothing here animates layout, because the subtree is a FlashList of images).
 *
 *   BOTTOM. A translate cannot make a bottom gap here. The container is `expanded` tall, anchored
 *   at `bottom: 0`, and deliberately hangs off the bottom of the screen — translating it up only
 *   reveals more of it, it never lifts its bottom edge above the screen edge. So the bottom gap is
 *   the `bottom` offset itself. That IS a layout property, which is why it moves only when the
 *   detent snaps, never per frame of the drag.
 *
 * ── CORRECTION: THE BOTTOM GAP WAS STRUCTURALLY IMPOSSIBLE, AND SNAPPING WAS WRONG ─────
 *
 * Two things were reported about the first attempt, and both were right.
 *
 * 1. THERE WAS NO BOTTOM GAP. The sides floated, the bottom did not. Animating the `bottom` offset
 *    could never have produced one, and the reason is worth stating precisely: the container was
 *    `expanded` tall, anchored at `bottom: 0`, and DELIBERATELY hung off the bottom of the screen so
 *    that a downward translate could hide the unwanted part of it. Its own bottom edge therefore sat
 *    hundreds of points below the display. Raising it by 12 pt did not lift that edge into view, it
 *    just revealed 12 pt more of the panel. The visible bottom of the panel was the SCREEN edge, and
 *    no offset applied to an off-screen edge can change that.
 *
 *    So the height mechanism itself had to change. The container is now exactly as tall as the
 *    visible panel and the content lives in a fixed-height wrapper inside it — the same
 *    constant-layout-inside, clip-outside trick this file already relied on, moved one level in. The
 *    grid is still laid out once at full height and never re-measures; the container's height change
 *    only moves its clip rect. That keeps the guarantee that matters (no layout work proportional to
 *    the number of cells) while making the panel's bottom edge a real edge that can be offset.
 *
 * 2. THE EXPANSION ONLY HAPPENED ON RELEASE. `floatSnap` animated in `onEnd`, so the panel widened
 *    after the finger lifted rather than under it. Requested: it should expand while being dragged,
 *    "not only when I let go".
 *
 *    Everything is now derived CONTINUOUSLY from `height`, which already tracks the finger. The
 *    scale, the bottom gap and the corner radii all interpolate from the same progress, so the panel
 *    grows toward the edges as it is dragged and arrives at the edges exactly when it is fully open.
 *    No second state to keep in sync, and no discontinuity at the moment of release.
 */
const FLOAT_SCALE = 0.94;
const FLOAT_GAP_BOTTOM = 12;
/** Grid geometry. Three columns matches the system picker's density. */
const COLUMNS = 3;
const CELL_GAP = 2;
const CELL_SIZE = Math.floor((SCREEN_W - CELL_GAP * (COLUMNS - 1)) / COLUMNS);
/** First page of assets. Enough to fill several screens without a long initial read. */
const PAGE_SIZE = 90;

export interface PhotoAsset {
  id: string;
  /** May be a `ph://` reference on iOS — resolved to a file URI on confirm. */
  uri: string;
}

export interface PhotoPickerPanelProps {
  /** Collapsed height — the parent passes the last real keyboard height. */
  collapsedHeight: number;
  bottomInset: number;
  theme: any;
  /** Max number of photos the composer accepts, counting ones already attached. */
  selectionLimit: number;
  labels: {
    title: string;
    send: string;
    systemPicker: string;
    permission: string;
    empty: string;
  };
  /** Confirmed selection, as local file URIs ready for the composer. */
  onConfirm: (uris: string[]) => void;
  /** Fall back to the OS sheet (permission denied, or the user asks for it). */
  onOpenSystemPicker: () => void;
  onClose: () => void;
}

function PhotoPickerPanelComponent({
  collapsedHeight,
  bottomInset,
  theme,
  selectionLimit,
  labels,
  onConfirm,
  onOpenSystemPicker,
  onClose,
}: PhotoPickerPanelProps) {
  const glassActive = useLiquidGlassActive();

  const collapsed = Math.max(collapsedHeight, 280);
  const expanded = Math.round(SCREEN_H * EXPANDED_RATIO);

  // ── Size, driven on the UI thread WITHOUT touching layout ──────────────────
  //
  // `height` is the panel's VISIBLE height. It used to be applied literally, as
  // `useAnimatedStyle(() => ({ height: height.value }))`, and that was the single
  // worst performance decision in this component: animating a layout property runs a
  // full Fabric layout pass over the subtree — which contains a FlashList of image
  // cells — on EVERY frame of a drag. Exactly the failure mode diagnosed at length in
  // `BrowserBottomBand.tsx`.
  //
  // Now the container is a CONSTANT `expanded` tall, anchored to the bottom, and is
  // pushed down by `expanded - height` so that precisely `height` of it is on screen.
  // A transform does not participate in layout, so the drag is pure compositor work
  // and holds frame rate regardless of what is mounted inside.
  //
  // Side benefit: the grid is always laid out at full height, so expanding reveals
  // rows that are already rendered instead of mounting them mid-animation.
  // ── STARTS AT ZERO SO THERE IS SOMETHING TO ANIMATE ───────────────────────
  //
  // Reported: the gallery panel "opens too abruptly and closes too abruptly".
  //
  // It had no open or close animation at all, and this initial value is why. The panel is mounted by
  // a boolean in the chat screen (`photoPanelOpen && <PhotoPickerPanel/>`) and `height` started
  // already AT `collapsed`, so the first committed frame was the panel at full size — it appeared.
  // The close was the mirror: `onClose` cleared the boolean and React unmounted the subtree in that
  // same commit, so it vanished. Nothing was ever wrong with the animation code, because there was
  // none; the value simply had no distance to cover.
  //
  // Starting at 0 gives the rise somewhere to come from, and `requestClose` below gives the exit
  // somewhere to go before the parent is told.
  const height = useSharedValue(0);
  // Height at the moment the drag started, so the gesture is a pure delta.
  const dragStart = useSharedValue(collapsed);

  /** First run is the ENTER; later runs are the keyboard-height re-snap. Different durations. */
  const didEnter = useRef(false);
  const closing = useRef(false);

  useEffect(() => {
    if (!didEnter.current) {
      didEnter.current = true;
      // Rise from the bottom edge. Longer than the re-snap because this is the one the user watches.
      height.value = withTiming(collapsed, { duration: 320, easing: Easing.out(Easing.cubic) });
      return;
    }
    // Re-snap when the collapsed target changes (keyboard height learned late)
    // and the user has not expanded the panel. Never while closing — that would
    // pull the panel back up mid-exit.
    if (closing.current) return;
    if (height.value < (collapsed + expanded) / 2) {
      height.value = withTiming(collapsed, { duration: 180, easing: Easing.out(Easing.cubic) });
    }
  }, [collapsed, expanded, height]);

  /**
   * Fall back down, THEN tell the parent.
   *
   * The parent's `onClose` unmounts this component, so calling it first means the exit never gets a
   * frame. Everything that dismisses the panel goes through here: the chevron, and the drag.
   */
  const requestClose = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    height.value = withTiming(0, { duration: 260, easing: Easing.in(Easing.cubic) }, (done) => {
      if (done) runOnJS(onClose)();
    });
  }, [height, onClose]);

  const panelStyle = useAnimatedStyle(() => {
    // ONE progress value, read straight off the finger. Everything below interpolates from it, which
    // is what makes the float track the drag instead of appearing after it.
    const p = interpolate(height.value, [collapsed, expanded], [0, 1], Extrapolation.CLAMP);
    const s = interpolate(p, [0, 1], [FLOAT_SCALE, 1], Extrapolation.CLAMP);
    return {
      // The container is now exactly the visible panel. Its child is a fixed-height stack, so this
      // moves the clip rect and nothing re-measures. Divided by `s` because the scale below is about
      // `bottom center`, which draws the box at `s * height` — dividing cancels it so the panel is
      // exactly `height.value` tall on screen at every point of the drag.
      height: height.value / s,
      // A real edge now, so an offset on it actually shows. Closes to 0 as the panel opens.
      bottom: interpolate(p, [0, 1], [FLOAT_GAP_BOTTOM, 0], Extrapolation.CLAMP),
      // Bottom corners round off while floating and square up as it reaches the edges. The top pair
      // is constant in `styles.container` — rounded throughout.
      borderBottomLeftRadius: interpolate(p, [0, 1], [28, 0], Extrapolation.CLAMP),
      borderBottomRightRadius: interpolate(p, [0, 1], [28, 0], Extrapolation.CLAMP),
      // The horizontal inset. Still a scale rather than a width, for the grid reason above, and now
      // continuous. `transformOrigin: 'bottom center'` lives in `styles.container` so the box grows
      // upward from its own bottom edge rather than about its middle.
      transform: [{ scale: s }],
    };
  });

  const drag = useMemo(
    () =>
      Gesture.Pan()
        .onStart(() => {
          dragStart.value = height.value;
        })
        .onUpdate((e) => {
          // Dragging UP (negative translationY) grows the panel.
          const next = dragStart.value - e.translationY;
          // Allow a little overshoot below `collapsed` so the close intent is
          // expressible, and clamp hard at `expanded`.
          height.value = Math.min(Math.max(next, collapsed - CLOSE_DRAG - 40), expanded);
        })
        .onEnd((e) => {
          const h = height.value;
          // Flung or dragged far enough below the collapsed stop → dismiss.
          //
          // Continues the drag down to 0 and only then hands over, instead of calling `onClose`
          // straight from the gesture. Calling it here used to unmount the panel from wherever the
          // finger happened to leave it, which is a cut, not a dismissal. Animated on the UI thread
          // so there is no JS hop between the release and the movement.
          if (h < collapsed - CLOSE_DRAG || (e.velocityY > 900 && h <= collapsed + 8)) {
            height.value = withTiming(0, { duration: 220, easing: Easing.in(Easing.cubic) }, (done) => {
              if (done) runOnJS(onClose)();
            });
            return;
          }
          // Otherwise snap to whichever stop the velocity/position points at.
          const midpoint = (collapsed + expanded) / 2;
          const target = e.velocityY < -400 ? expanded : e.velocityY > 400 ? collapsed : h > midpoint ? expanded : collapsed;
          // Damping 22 -> 26. At 22 the ratio was 22 / (2 * sqrt(220 * 0.7)) = 0.89, so the panel
          // overshot its stop and settled back — the same "moves up a bit then a bit down" that was
          // reported on the share sheet, from the same cause. 26 puts it just past critical.
          height.value = withSpring(target, { damping: 26, stiffness: 220, mass: 0.7 });
          // Nothing else to animate here any more: the inset, the radii and the gap all derive from
          // `height`, so settling it settles them.
        }),
    [collapsed, expanded, height, dragStart, onClose],
  );

  // ── Assets ─────────────────────────────────────────────────────────────────
  const [assets, setAssets] = useState<PhotoAsset[]>([]);
  const [permission, setPermission] = useState<'pending' | 'granted' | 'denied'>('pending');
  const [loadingMore, setLoadingMore] = useState(false);
  const cursorRef = useRef<string | undefined>(undefined);
  const hasMoreRef = useRef(true);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadPage = useCallback(async (first: boolean) => {
    if (!first && (!hasMoreRef.current || loadingMore)) return;
    setLoadingMore(true);
    try {
      const MediaLibrary = await import('expo-media-library');
      if (first) {
        // `writeOnly: false` — listing the library needs read access; the
        // add-only scope (`true`) cannot enumerate assets. Requested here, at the
        // moment the user taps attach, rather than on app launch, so the system
        // prompt always has obvious context. iOS's "Limited Access" answer also
        // resolves as granted and simply returns the subset the user allowed,
        // which the grid renders without any special case.
        const res = await MediaLibrary.requestPermissionsAsync(false);
        if (!mountedRef.current) return;
        if (!res.granted) {
          setPermission('denied');
          return;
        }
        setPermission('granted');
      }
      const page = await MediaLibrary.getAssetsAsync({
        first: PAGE_SIZE,
        after: first ? undefined : cursorRef.current,
        mediaType: ['photo'],
        sortBy: ['creationTime'],
      });
      if (!mountedRef.current) return;
      cursorRef.current = page.endCursor;
      hasMoreRef.current = page.hasNextPage;
      const mapped = page.assets.map((a) => ({ id: a.id, uri: a.uri }));
      setAssets((prev) => (first ? mapped : prev.concat(mapped)));
    } catch {
      if (mountedRef.current) setPermission('denied');
    } finally {
      if (mountedRef.current) setLoadingMore(false);
    }
    // `loadingMore` is intentionally read, not depended on: including it would
    // rebuild the callback on every page and re-arm `onEndReached`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void loadPage(true);
  }, [loadPage]);

  // ── Selection ──────────────────────────────────────────────────────────────
  // Order matters (the composer shows them in pick order), so this is an array
  // rather than a Set.
  const [selected, setSelected] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);

  const toggle = useCallback(
    (id: string) => {
      setSelected((prev) => {
        const at = prev.indexOf(id);
        if (at !== -1) return prev.filter((x) => x !== id);
        if (prev.length >= selectionLimit) return prev;
        return prev.concat(id);
      });
    },
    [selectionLimit],
  );

  const confirm = useCallback(async () => {
    if (selected.length === 0 || confirming) return;
    setConfirming(true);
    try {
      const MediaLibrary = await import('expo-media-library');
      const byId = new Map(assets.map((a) => [a.id, a] as const));
      // iOS hands back `ph://` identifiers that image manipulation and upload
      // cannot read; `getAssetInfoAsync` resolves the real local file. Resolved in
      // parallel — a serial loop over six assets is a visible pause.
      const uris = await Promise.all(
        selected.map(async (id) => {
          try {
            const info = await MediaLibrary.getAssetInfoAsync(id);
            return info?.localUri || info?.uri || byId.get(id)?.uri || null;
          } catch {
            return byId.get(id)?.uri || null;
          }
        }),
      );
      const resolved = uris.filter((u): u is string => !!u);
      if (resolved.length > 0) onConfirm(resolved);
      // Through `requestClose`, not `onClose`: send is the most common way this panel leaves the
      // screen, so it is the one that most needed the exit it did not have.
      requestClose();
    } finally {
      if (mountedRef.current) setConfirming(false);
    }
  }, [selected, confirming, assets, onConfirm, requestClose]);

  const renderCell = useCallback(
    ({ item }: { item: PhotoAsset }) => (
      <PhotoCell
        asset={item}
        order={selected.indexOf(item.id)}
        accent={theme.colors.accent.primary}
        onPress={toggle}
      />
    ),
    [selected, theme.colors.accent.primary, toggle],
  );

  const keyExtractor = useCallback((a: PhotoAsset) => a.id, []);

  const onEndReached = useCallback(() => {
    void loadPage(false);
  }, [loadPage]);

  const canSend = selected.length > 0;

  return (
    <Reanimated.View
      style={[
        styles.container,
        {
          // Height is ANIMATED now, in `panelStyle`. It is not set here.
          backgroundColor: glassActive ? 'transparent' : theme.colors.background.elevated,
        },
        panelStyle,
      ]}
    >
      {/* ── THE INSULATING WRAPPER ────────────────────────────────────────────────
   
          Constant `expanded` height, so everything inside is laid out ONCE at full size and never
          re-measures while the container's height animates around it. The container clips it
          (`overflow: hidden`), which is the whole mechanism: growing the panel reveals rows that are
          already rendered rather than mounting them mid-drag.
   
          This is the same guarantee the panel had before, just relocated. Previously the container
          was the constant one and was pushed off-screen by a transform; that could not produce a
          bottom gap, because its bottom edge was never on screen to be offset. Now the container is
          the visible panel and this wrapper holds the constant layout. */}
      <View style={{ height: expanded }}>
        {glassActive ? (
          <GlassBg
            borderRadius={28}
            glassStyle="regular"
            interactive={false}
            colorScheme={theme.isDark ? 'dark' : 'light'}
            tintColor={theme.isDark ? 'rgba(26,26,31,0.55)' : 'rgba(255,255,255,0.55)'}
          />
        ) : null}

      {/* Grabber + header. The whole strip is the drag target — a 20 pt handle
          alone is under Apple's 44 pt minimum and easy to miss. */}
      <GestureDetector gesture={drag}>
        <View style={styles.header}>
          <View style={[styles.grabber, { backgroundColor: theme.colors.text.tertiary }]} />
          <View style={styles.headerRow}>
            <Pressable onPress={requestClose} hitSlop={8} style={styles.headerBtn} accessibilityRole="button">
              <Feather name="chevron-down" size={20} color={theme.colors.text.secondary} />
            </Pressable>
            <RNText style={[styles.title, { color: theme.colors.text.primary }]} numberOfLines={1}>
              {labels.title}
            </RNText>
            <Pressable onPress={onOpenSystemPicker} hitSlop={8} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel={labels.systemPicker}>
              <Feather name="folder" size={18} color={theme.colors.text.secondary} />
            </Pressable>
          </View>
        </View>
      </GestureDetector>

      {permission === 'denied' ? (
        <View style={styles.notice}>
          <Feather name="image" size={26} color={theme.colors.text.tertiary} />
          <RNText style={[styles.noticeText, { color: theme.colors.text.secondary }]}>{labels.permission}</RNText>
          <Pressable
            onPress={onOpenSystemPicker}
            style={[styles.noticeBtn, { backgroundColor: theme.colors.accent.primary }]}
            accessibilityRole="button"
          >
            <RNText style={styles.noticeBtnText}>{labels.systemPicker}</RNText>
          </Pressable>
        </View>
      ) : permission === 'pending' && assets.length === 0 ? (
        <View style={styles.notice}>
          <ActivityIndicator color={theme.colors.text.tertiary} />
        </View>
      ) : assets.length === 0 ? (
        <View style={styles.notice}>
          <RNText style={[styles.noticeText, { color: theme.colors.text.secondary }]}>{labels.empty}</RNText>
        </View>
      ) : (
        <FlashList
          data={assets}
          renderItem={renderCell}
          keyExtractor={keyExtractor}
          numColumns={COLUMNS}
          onEndReached={onEndReached}
          onEndReachedThreshold={0.6}
          // Leaves room for the floating send button so the last row is reachable.
          contentContainerStyle={{ paddingBottom: 76 + bottomInset }}
          keyboardShouldPersistTaps="always"
        />
      )}
      </View>

      {/* Send button — appears only with a selection. A direct child of the CONTAINER, deliberately
          outside the fixed-height wrapper: the container is exactly the visible panel now, so
          anchoring to its bottom keeps the button at the visible bottom edge on its own. It used to
          need a counter-transform cancelling the panel's offset, and that offset no longer exists. */}
      {canSend ? (
        <View
          style={[styles.sendWrap, { bottom: 12 + bottomInset }]}
          pointerEvents="box-none"
        >
          {glassActive ? (
            <Pressable onPress={confirm} disabled={confirming} style={styles.sendPress}>
              <NativeGlassView glassStyle="regular" isInteractive colorScheme={theme.isDark ? 'dark' : 'light'} style={styles.sendFill}>
                <Feather name="send" size={16} color={theme.colors.accent.primary} />
                <RNText style={[styles.sendText, { color: theme.colors.accent.primary }]}>
                  {labels.send} ({selected.length})
                </RNText>
              </NativeGlassView>
            </Pressable>
          ) : (
            <Pressable
              onPress={confirm}
              disabled={confirming}
              style={[styles.sendPress, styles.sendFill, { backgroundColor: theme.colors.accent.primary }]}
            >
              <Feather name="send" size={16} color="#FFFFFF" />
              <RNText style={[styles.sendText, { color: '#FFFFFF' }]}>
                {labels.send} ({selected.length})
              </RNText>
            </Pressable>
          )}
        </View>
      ) : null}
    </Reanimated.View>
  );
}

/**
 * One thumbnail.
 *
 * Memoized on the props that can actually change its pixels — the asset and its
 * position in the selection. Without this, ticking one photo re-rendered every
 * mounted cell (a full grid of image components) on each tap.
 *
 * Uses `expo-image` directly rather than `CachedImage`: these are LOCAL assets, so
 * the proxy/remote-cache logic `CachedImage` adds is dead weight, and `recyclingKey`
 * lets FlashList recycle the view without showing the previous photo for a frame.
 */
const PhotoCell = memo(
  function PhotoCell({
    asset,
    order,
    accent,
    onPress,
  }: {
    asset: PhotoAsset;
    order: number;
    accent: string;
    onPress: (id: string) => void;
  }) {
    const selected = order !== -1;
    return (
      <Pressable onPress={() => onPress(asset.id)} style={styles.cell}>
        <Image
          source={{ uri: asset.uri }}
          style={styles.cellImage}
          contentFit="cover"
          recyclingKey={asset.id}
          transition={0}
          cachePolicy="memory-disk"
        />
        {selected ? (
          <>
            <View style={[styles.cellSelectedRing, { borderColor: accent }]} />
            <View style={[styles.cellBadge, { backgroundColor: accent }]}>
              <RNText style={styles.cellBadgeText}>{order + 1}</RNText>
            </View>
          </>
        ) : null}
      </Pressable>
    );
  },
  (prev, next) =>
    prev.asset.id === next.asset.id && prev.order === next.order && prev.accent === next.accent && prev.onPress === next.onPress,
);

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    overflow: 'hidden',
    // Grow upward from the panel's own bottom edge. With the default centre origin the scale would
    // move the box vertically as it changed, fighting the height that is driving it.
    transformOrigin: 'bottom center',
    zIndex: 220,
  },
  header: { paddingTop: 8, paddingBottom: 4 },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, opacity: 0.5 },
  headerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, height: 40 },
  headerBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', fontSize: 14, fontWeight: '700' },
  notice: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 32 },
  noticeText: { fontSize: 13, textAlign: 'center', lineHeight: 18 },
  noticeBtn: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 14 },
  noticeBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  cell: { width: CELL_SIZE, height: CELL_SIZE, marginRight: CELL_GAP, marginBottom: CELL_GAP },
  cellImage: { width: '100%', height: '100%', backgroundColor: 'rgba(127,127,127,0.12)' },
  cellSelectedRing: { ...StyleSheet.absoluteFillObject, borderWidth: 3 },
  cellBadge: {
    position: 'absolute',
    top: 5,
    right: 5,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellBadgeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  sendWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  sendPress: { borderRadius: 22, overflow: 'hidden' },
  sendFill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 44,
    paddingHorizontal: 22,
    borderRadius: 22,
  },
  sendText: { fontSize: 14, fontWeight: '700' },
});

export const PhotoPickerPanel = memo(PhotoPickerPanelComponent);
