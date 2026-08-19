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

  // ── Height, driven on the UI thread ────────────────────────────────────────
  const height = useSharedValue(collapsed);
  // Height at the moment the drag started, so the gesture is a pure delta.
  const dragStart = useSharedValue(collapsed);

  useEffect(() => {
    // Re-snap when the collapsed target changes (keyboard height learned late)
    // and the user has not expanded the panel.
    if (height.value < (collapsed + expanded) / 2) {
      height.value = withTiming(collapsed, { duration: 180, easing: Easing.out(Easing.cubic) });
    }
  }, [collapsed, expanded, height]);

  const panelStyle = useAnimatedStyle(() => ({ height: height.value }));

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
          if (h < collapsed - CLOSE_DRAG || (e.velocityY > 900 && h <= collapsed + 8)) {
            runOnJS(onClose)();
            return;
          }
          // Otherwise snap to whichever stop the velocity/position points at.
          const midpoint = (collapsed + expanded) / 2;
          const target = e.velocityY < -400 ? expanded : e.velocityY > 400 ? collapsed : h > midpoint ? expanded : collapsed;
          height.value = withSpring(target, { damping: 22, stiffness: 220, mass: 0.7 });
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
      onClose();
    } finally {
      if (mountedRef.current) setConfirming(false);
    }
  }, [selected, confirming, assets, onConfirm, onClose]);

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
        { backgroundColor: glassActive ? 'transparent' : theme.colors.background.elevated },
        panelStyle,
      ]}
    >
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
            <Pressable onPress={onClose} hitSlop={8} style={styles.headerBtn} accessibilityRole="button">
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

      {/* Send button — appears only with a selection, and rides in on translateY
          so no glass ancestor ever gets an opacity of 0. */}
      {canSend ? (
        <View style={[styles.sendWrap, { bottom: 12 + bottomInset }]} pointerEvents="box-none">
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
