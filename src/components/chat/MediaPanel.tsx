import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { View, Pressable, ScrollView, Text as RNText, StyleSheet, Dimensions, InteractionManager } from 'react-native';
import { BlurView } from 'expo-blur';
import { Feather } from '@expo/vector-icons';
import Reanimated, { useSharedValue, useAnimatedStyle, withTiming, Easing, runOnJS } from 'react-native-reanimated';
import { useLiquidGlassActive, GlassBg, NativeGlassView } from '../ui/LiquidGlass';
import { CachedImage } from '../ui/CachedImage';
import { EmojiPanel } from './EmojiPanel';
import { GifPanel } from './GifPanel';
import { GiphyItem } from '../../services/giphy';
import { useCustomGifs } from '../../store/customGifsStore';
import { AddGifModal } from './AddGifModal';
import { triggerHaptic } from '../../utils/haptics';

const PANEL_W = Dimensions.get('window').width;
// Height of the recents strip. Shared by its own style, the grids' top content padding and the
// hide-on-scroll travel, so those three cannot drift out of agreement.
const RECENT_ROW_H = 46;
// Travel needed to put the bottom switcher fully outside the clipped container.
const BOTTOM_CHROME_H = 56;

export type MediaTab = 'emoji' | 'gif';

/** Strings for the add-GIF dialog, passed down so this tree does no i18n of its own. */
export type AddGifLabels = React.ComponentProps<typeof AddGifModal>['labels'];

export interface MediaPanelProps {
  /** Panel height (≈ last real keyboard height) supplied by the parent. */
  height: number;
  /** Active tab. */
  tab: MediaTab;
  /** Switch tab (bottom segmented control). */
  onTabChange: (tab: MediaTab) => void;
  /** Insert an emoji (recent row + emoji grid). */
  onSelectEmoji: (e: string) => void;
  /** Send a GIF (gif grid) — receives the full item to record in recents. */
  onSelectGif: (item: GiphyItem) => void;
  /** Delete the last character from the composer (backspace circle). */
  onBackspace: () => void;
  /** Most-recently-used emoji, shown as a quick-pick row at the top. */
  recentEmoji: string[];
  /** Most-recently-used GIFs, prepended to the GIF grid. */
  recentGifs: GiphyItem[];
  theme: any;
  bottomInset?: number;
  /** Localized labels so we don't pull the i18n hook here. */
  labels: { gif: string; emoji: string; copy: string; send: string; addGif: AddGifLabels };
  /** Long-press popup → send a single emoji as its own chat message. */
  onSendEmoji?: (e: string) => void;
  /** Long-press popup → copy an emoji to the clipboard. */
  onCopyEmoji?: (e: string) => void;
  /** Long-press popup → send a GIF to the chat (same path as a tap). */
  onSendGif?: (item: GiphyItem) => void;
  /** Long-press popup → copy a GIF (its URL) to the clipboard. */
  onCopyGif?: (item: GiphyItem) => void;
}

// ── Unified chat media panel ───────────────────────────────────────────────
//
// One docked surface that hosts BOTH the emoji grid and the GIF grid on a
// horizontal track, plus a Telegram-style bottom segmented switcher (GIF /
// Эмодзи) and a shared "recently used emoji" quick-row at the top. Switching
// tabs slides the track left/right on the UI thread (native translateX) — both
// children stay mounted so the slide carries real content with zero pop-in.
function MediaPanelComponent({
  height,
  tab,
  onTabChange,
  onSelectEmoji,
  onSelectGif,
  onBackspace,
  recentEmoji,
  recentGifs,
  theme,
  bottomInset = 0,
  labels,
  onSendEmoji,
  onCopyEmoji,
  onSendGif,
  onCopyGif,
}: MediaPanelProps) {
  const glassActive = useLiquidGlassActive();

  // ── Lazy-mount the inactive tab ────────────────────────────────────────────
  // The panel mounts the instant the user taps GIF/emoji — on the SAME frame as
  // the open/rise animation. Mounting BOTH heavy grids (the ~96-cell emoji
  // FlatList AND the GIF grid) on that frame is the dominant "menu freezes when
  // it opens" cost. So we mount ONLY the tab the user opened, and bring the
  // other one in a tick later (after interactions) — off the open frame, but
  // ready well before the user could slide to it. If the user switches tabs
  // before that deferral fires, we mount it immediately.
  const initialTab = useRef(tab).current;
  const [mountInactive, setMountInactive] = useState(false);
  // ── THE INACTIVE TAB IS NO LONGER PRE-MOUNTED ─────────────────────────────
  //
  // This used to be `runAfterInteractions(() => setMountInactive(true))`, so a tick after the
  // panel opened, the tab the user did NOT ask for mounted too, off-screen behind the track's
  // `overflow: hidden`.
  //
  // For the GIF grid that is not a cheap warm-up: mounting it runs its trending fetch and
  // starts a thumbnail request per visible cell. So opening EMOJI paid for the entire GIF
  // thumbnail storm, invisibly, every time — while the panel was animating in.
  //
  // The intent was that sliding to the other tab should feel instant. It still does: the effect
  // below mounts the other tab the moment `tab` actually changes, and the horizontal slide is a
  // 260 ms UI-thread transform, which is more than enough time for a grid to commit behind it.
  // The difference is that the cost is now paid by users who slide, at the moment they slide,
  // instead of by everyone on every open.
  useEffect(() => {
    if (tab !== initialTab) setMountInactive(true);
  }, [tab, initialTab]);
  const showEmoji = initialTab === 'emoji' || mountInactive;
  const showGif = initialTab === 'gif' || mountInactive;

  // Horizontal slide. 0 → emoji, 1 → gif. Native-driver translateX.
  const tabSV = useSharedValue(tab === 'gif' ? 1 : 0);
  useEffect(() => {
    tabSV.value = withTiming(tab === 'gif' ? 1 : 0, {
      duration: 260,
      easing: Easing.out(Easing.cubic),
    });
  }, [tab, tabSV]);
  const trackStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -tabSV.value * PANEL_W }],
  }));

  // ── Long-press preview popup (additive overlay) ───────────────────────────
  // A SEPARATE absolute overlay above the panel — it never touches the slide
  // track, the bottom switcher, or the lift. Long-pressing any emoji/GIF cell
  // opens it with the item ENLARGED and Copy/Send buttons beneath. A normal
  // tap is unchanged (insert emoji / send GIF). Dim backdrop, tap-outside to
  // dismiss, native-driver scale+opacity in.
  type Preview =
    | { kind: 'emoji'; emoji: string }
    | { kind: 'gif'; item: GiphyItem };
  const [preview, setPreview] = useState<Preview | null>(null);
  const previewSV = useSharedValue(0);

  const openPreview = useCallback((p: Preview) => {
    setPreview(p);
    previewSV.value = withTiming(1, { duration: 160, easing: Easing.out(Easing.cubic) });
  }, [previewSV]);

  // Animated dismiss for the backdrop tap (panel stays open).
  const closePreview = useCallback(() => {
    previewSV.value = withTiming(0, { duration: 130 }, (finished) => {
      if (finished) runOnJS(setPreview)(null);
    });
  }, [previewSV]);

  // Immediate teardown — used by the action buttons, since "Send GIF" closes
  // the whole panel (this component unmounts) and we don't want an animation
  // callback firing into an unmounted tree.
  const tearDownPreview = useCallback(() => {
    previewSV.value = 0;
    setPreview(null);
  }, [previewSV]);

  const onLongPressEmoji = useCallback((e: string) => openPreview({ kind: 'emoji', emoji: e }), [openPreview]);
  const onLongPressGif = useCallback((item: GiphyItem) => openPreview({ kind: 'gif', item }), [openPreview]);

  const previewCardStyle = useAnimatedStyle(() => ({
    opacity: previewSV.value,
    transform: [{ scale: 0.86 + previewSV.value * 0.14 }],
  }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: previewSV.value }));

  const hasRecents = recentEmoji.length > 0;

  // ── Scroll-driven chrome ───────────────────────────────────────────────────
  //
  // 1 = both strips in place, 0 = both gone. Driven by raw scroll ticks reported by whichever grid is
  // active, latched so the animation is STARTED ONCE per gesture rather than re-issued on every scroll
  // event — a `withTiming` restarted 60 times a second never finishes, and the JS-thread churn of
  // dispatching it is precisely what made an earlier version of the chat's scroll handler a perf bug.
  const chromeSV = useSharedValue(1);
  const chromeHiddenRef = useRef(false);
  const chromeIdleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onScrollTick = useCallback(() => {
    if (!chromeHiddenRef.current) {
      chromeHiddenRef.current = true;
      chromeSV.value = withTiming(0, { duration: 170, easing: Easing.out(Easing.cubic) });
    }
    if (chromeIdleRef.current) clearTimeout(chromeIdleRef.current);
    // Restore shortly after the last scroll event, which covers a finger drag and a momentum fling
    // with one rule. Slower coming back than going away: leaving should feel like it got out of the
    // way, returning should feel deliberate.
    chromeIdleRef.current = setTimeout(() => {
      chromeHiddenRef.current = false;
      chromeSV.value = withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) });
    }, 240);
  }, [chromeSV]);

  useEffect(() => () => { if (chromeIdleRef.current) clearTimeout(chromeIdleRef.current); }, []);

  const topChromeStyle = useAnimatedStyle(() => ({
    opacity: chromeSV.value,
    transform: [{ translateY: -(1 - chromeSV.value) * RECENT_ROW_H }],
  }));
  const bottomChromeStyle = useAnimatedStyle(() => ({
    opacity: chromeSV.value,
    transform: [{ translateY: (1 - chromeSV.value) * (BOTTOM_CHROME_H + bottomInset) }],
  }));

  // Grid content padding. The top strip overlays the grid, so the grid has to start below it.
  const gridTopInset = hasRecents ? RECENT_ROW_H : 0;

  // The user's own GIFs, added by pasting a link. Field selectors so an unrelated store write cannot
  // re-render this panel while it is animating open.
  const customGifs = useCustomGifs((s) => s.items);
  const removeCustomGif = useCustomGifs((s) => s.remove);
  const [addOpen, setAddOpen] = useState(false);
  const openAddGif = useCallback(() => {
    triggerHaptic('light');
    // Switch to the GIF tab first: adding a GIF while looking at the emoji grid would put the new
    // sticker somewhere the user cannot see it, which reads as the button having done nothing.
    if (tab !== 'gif') onTabChange('gif');
    setAddOpen(true);
  }, [tab, onTabChange]);
  const closeAddGif = useCallback(() => setAddOpen(false), []);

  const renderSwitch = useCallback(
    (key: MediaTab, label: string) => {
      const active = tab === key;
      return (
        <Pressable
          key={key}
          onPress={() => { if (!active) onTabChange(key); }}
          style={[
            styles.segment,
            active && { backgroundColor: theme.colors.accent.primary },
          ]}
        >
          <RNText
            style={{
              fontSize: 13,
              fontWeight: '700',
              color: active ? '#FFFFFF' : theme.colors.text.secondary,
            }}
          >
            {label}
          </RNText>
        </Pressable>
      );
    },
    [tab, onTabChange, theme],
  );

  return (
    <View
      style={[
        styles.container,
        { height, backgroundColor: glassActive ? 'transparent' : theme.colors.background.elevated },
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

      {/* ── BOTH STRIPS GET OUT OF THE WAY WHILE YOU SCROLL ──────────────────────
   
          Asked for: the recents strip at the top and the GIF/Эмодзи row at the bottom should disappear
          while scrolling — top upward, bottom downward — and come back smoothly.
   
          The top row is ABSOLUTE now, and that is the part that makes it work rather than merely look
          animated. In normal flow, sliding it up would have left a 46 pt hole above the grid and then
          filled it again on the way back — two layout passes per gesture, on the thread the scroll is
          running on. Absolute, with the grid padded by the same amount, means the grid content simply
          slides under it and NOTHING is laid out: the whole thing is one transform on the UI thread.
          The bottom row already worked this way, which is why the switcher has always floated over the
          grid with `56 + inset` of content padding beneath it.
   
          Each strip travels far enough to leave the container entirely, and the container clips
          (`overflow: 'hidden'`). So a hidden strip is not merely invisible — it is outside, and cannot
          swallow a tap meant for the grid. That avoids needing a `pointerEvents` flag, and therefore
          avoids a React state dispatch during a scroll, which is exactly the mistake the chat screen's
          scroll handler carries a long note about. */}
      {hasRecents ? (
        <Reanimated.View style={[styles.recentRow, topChromeStyle, { borderBottomColor: theme.colors.border.light }]}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="always"
            contentContainerStyle={styles.recentContent}
          >
            {recentEmoji.map((e, i) => (
              <Pressable
                key={e + i}
                onPress={() => onSelectEmoji(e)}
                onLongPress={onSendEmoji || onCopyEmoji ? () => onLongPressEmoji(e) : undefined}
                delayLongPress={280}
                hitSlop={4}
                style={styles.recentCell}
              >
                <RNText style={styles.recentEmoji} allowFontScaling={false}>{e}</RNText>
              </Pressable>
            ))}
          </ScrollView>
        </Reanimated.View>
      ) : null}

      {/* Sliding track — both grids mounted side by side. */}
      <View style={styles.trackWrap}>
        <Reanimated.View style={[styles.track, trackStyle]}>
          <View style={styles.page}>
            {showEmoji ? (
              <EmojiPanel bare height={height} onSelect={onSelectEmoji} onLongPress={onSendEmoji || onCopyEmoji ? onLongPressEmoji : undefined} theme={theme} bottomInset={56 + bottomInset} topInset={gridTopInset} onScrollTick={onScrollTick} />
            ) : <View style={styles.bareFill} />}
          </View>
          <View style={styles.page}>
            {showGif ? (
              <GifPanel bare height={height} onSelect={onSelectGif} onLongPress={onSendGif || onCopyGif ? onLongPressGif : undefined} recentGifs={recentGifs} theme={theme} bottomInset={56 + bottomInset} topInset={gridTopInset} onScrollTick={onScrollTick} customGifs={customGifs} onRemoveCustomGif={removeCustomGif} />
            ) : <View style={styles.bareFill} />}
          </View>
        </Reanimated.View>
      </View>

      {/* Bottom row: segmented GIF/Эмодзи switcher (glass on iOS-26, blur
          elsewhere) + a round backspace button so picks can be undone. */}
      <Reanimated.View style={[styles.switchWrap, bottomChromeStyle, { paddingBottom: 8 + bottomInset }]} pointerEvents="box-none">
        {/* ADD-YOUR-OWN, mirroring the backspace circle on the other side.
   
            Asked for: "on the left side, like the delete button but on the left next to the GIF, make a
            plus, and there the user can add their own GIFs or import from other social networks — they
            just paste a link."
   
            Left of the switcher rather than inside the grid, because it is a panel-level action like
            backspace is, not a cell. The symmetry is the affordance: one round button either side of the
            pill, one adds and one removes. */}
        {glassActive ? (
          <Pressable onPress={openAddGif} hitSlop={6} style={[styles.backspace, styles.addBtn]}>
            <NativeGlassView glassStyle="regular" isInteractive colorScheme={theme.isDark ? 'dark' : 'light'} style={styles.backspaceFill}>
              <Feather name="plus" size={20} color={theme.colors.text.secondary} />
            </NativeGlassView>
          </Pressable>
        ) : (
          <Pressable onPress={openAddGif} hitSlop={6} style={[styles.backspace, styles.backspaceFlat, styles.addBtn]}>
            <BlurView intensity={28} tint={theme.isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
            <Feather name="plus" size={20} color={theme.colors.text.secondary} />
          </Pressable>
        )}

        {glassActive ? (
          <NativeGlassView glassStyle="regular" isInteractive colorScheme={theme.isDark ? 'dark' : 'light'} style={styles.pill}>
            {renderSwitch('gif', labels.gif)}
            {renderSwitch('emoji', labels.emoji)}
          </NativeGlassView>
        ) : (
          <View style={[styles.pill, styles.pillFlat]}>
            <BlurView intensity={28} tint={theme.isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
            {renderSwitch('gif', labels.gif)}
            {renderSwitch('emoji', labels.emoji)}
          </View>
        )}

        {glassActive ? (
          <Pressable onPress={onBackspace} hitSlop={6} style={styles.backspace}>
            <NativeGlassView glassStyle="regular" isInteractive colorScheme={theme.isDark ? 'dark' : 'light'} style={styles.backspaceFill}>
              <Feather name="delete" size={18} color={theme.colors.text.secondary} />
            </NativeGlassView>
          </Pressable>
        ) : (
          <Pressable onPress={onBackspace} hitSlop={6} style={[styles.backspace, styles.backspaceFlat]}>
            <BlurView intensity={28} tint={theme.isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
            <Feather name="delete" size={18} color={theme.colors.text.secondary} />
          </Pressable>
        )}
      </Reanimated.View>

      {/* Long-press preview popup — additive absolute overlay. Sits ABOVE the
          slide track and switcher; never affects their layout/animation. */}
      {preview ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          <Reanimated.View style={[StyleSheet.absoluteFill, styles.previewBackdrop, backdropStyle]}>
            <Pressable style={StyleSheet.absoluteFill} onPress={closePreview} />
          </Reanimated.View>

          <View style={styles.previewCenter} pointerEvents="box-none">
            <Reanimated.View style={[styles.previewCard, previewCardStyle, { backgroundColor: theme.colors.background.elevated }]}>
              {preview.kind === 'emoji' ? (
                <RNText style={styles.previewEmoji} allowFontScaling={false}>{preview.emoji}</RNText>
              ) : (
                <CachedImage uri={preview.item.previewUrl} style={styles.previewGif} resizeMode="contain" />
              )}

              <View style={styles.previewActions}>
                <Pressable
                  style={[styles.previewBtn, { backgroundColor: theme.colors.background.secondary }]}
                  onPress={() => {
                    if (preview.kind === 'emoji') onCopyEmoji?.(preview.emoji);
                    else onCopyGif?.(preview.item);
                    tearDownPreview();
                  }}
                >
                  <Feather name="copy" size={15} color={theme.colors.text.secondary} />
                  <RNText style={[styles.previewBtnText, { color: theme.colors.text.primary }]}>{labels.copy}</RNText>
                </Pressable>

                <Pressable
                  style={[styles.previewBtn, { backgroundColor: theme.colors.accent.primary }]}
                  onPress={() => {
                    if (preview.kind === 'emoji') onSendEmoji?.(preview.emoji);
                    else onSendGif?.(preview.item);
                    tearDownPreview();
                  }}
                >
                  <Feather name="send" size={15} color="#FFFFFF" />
                  <RNText style={[styles.previewBtnText, { color: '#FFFFFF' }]}>{labels.send}</RNText>
                </Pressable>
              </View>
            </Reanimated.View>
          </View>
        </View>
      ) : null}

      {/* Add-your-own-GIF dialog. Rendered last so it paints above the grids and the switcher, and
          mounted only while open - it owns a TextInput and a Modal, neither of which should exist
          in the tree of a picker that is usually just being scrolled. */}
      {addOpen ? (
        <AddGifModal visible={addOpen} onClose={closeAddGif} theme={theme} labels={labels.addGif} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    overflow: 'hidden',
  },
  // ABSOLUTE, so hiding it on scroll is a transform and not a relayout. The grids pad their content
  // by RECENT_ROW_H to compensate, exactly as they already do for the bottom switcher.
  recentRow: { position: 'absolute', top: 0, left: 0, right: 0, height: RECENT_ROW_H, borderBottomWidth: 0.5, justifyContent: 'center', zIndex: 2 },
  recentContent: { paddingHorizontal: 10, alignItems: 'center', gap: 2 },
  recentCell: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  recentEmoji: { fontSize: 26 },
  trackWrap: { flex: 1, overflow: 'hidden' },
  bareFill: { flex: 1 },
  track: { flex: 1, flexDirection: 'row', width: PANEL_W * 2 },
  page: { width: PANEL_W },
  // The switcher floats over the bottom of the grids (the grids already pad
  // their content by 56 + inset so nothing hides under it).
  switchWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  pill: { flexDirection: 'row', borderRadius: 22, padding: 3, gap: 2, overflow: 'hidden' },
  pillFlat: { backgroundColor: 'rgba(127,127,127,0.16)' },
  segment: { paddingHorizontal: 20, paddingVertical: 8, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  backspace: { width: 40, height: 40, borderRadius: 20, marginLeft: 10, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  // Same circle as `backspace`, mirrored: the margin moves to the other side so the pill keeps equal
  // gaps and stays centred in the row.
  addBtn: { marginLeft: 0, marginRight: 10 },
  backspaceFill: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  backspaceFlat: { backgroundColor: 'rgba(127,127,127,0.16)' },
  // Long-press preview popup.
  previewBackdrop: { backgroundColor: 'rgba(0,0,0,0.5)' },
  previewCenter: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  previewCard: { borderRadius: 22, paddingHorizontal: 18, paddingTop: 18, paddingBottom: 14, alignItems: 'center', minWidth: 180, shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.25, shadowRadius: 16, elevation: 12 },
  previewEmoji: { fontSize: 96, lineHeight: 110, marginBottom: 8 },
  previewGif: { width: 200, height: 200, borderRadius: 14, marginBottom: 10, backgroundColor: 'rgba(127,127,127,0.12)' },
  previewActions: { flexDirection: 'row', gap: 10, marginTop: 2 },
  previewBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 14 },
  previewBtnText: { fontSize: 14, fontWeight: '700' },
});

export const MediaPanel = memo(MediaPanelComponent);
