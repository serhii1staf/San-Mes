import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { View, Pressable, ScrollView, Modal, StatusBar, Text as RNText, StyleSheet, Dimensions, InteractionManager } from 'react-native';
import { BlurView } from '../../components/ui/AppBlurView';
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
import { openUrl } from '../../utils/openUrl';
import { emojiTextStyle } from '../../components/ui/emojiText';

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
  labels: { gif: string; emoji: string; copy: string; send: string; viewPack: string; remove: string; addGif: AddGifLabels };
  /** Long-press popup → send a single emoji as its own chat message. */
  onSendEmoji?: (e: string) => void;
  /** Long-press popup → copy an emoji to the clipboard. */
  onCopyEmoji?: (e: string) => void;
  /** Long-press popup → send a GIF to the chat (same path as a tap). */
  onSendGif?: (item: GiphyItem) => void;
  /** Long-press popup → copy a GIF (its URL) to the clipboard. */
  onCopyGif?: (item: GiphyItem) => void;
  /**
   * Long-press popup → the sticker was deleted; drop it from the host screen's RECENTS state too.
   *
   * Deleting has to reach two lists. `customGifsStore` is global so this panel can clean it directly,
   * but recents is React state owned by the host screen (the chat and the comments screen each keep
   * their own copy, seeded from MMKV), so the panel cannot write it. Hence a callback rather than a
   * direct call: the panel says what happened, the owner of the state applies it.
   */
  onForgetGif?: (id: string) => void;
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
  onForgetGif,
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
    // ── COMING BACK HAD TO GET FASTER ─────────────────────────────────────────
    //
    // Reported: "it disappears, I stop, it comes back — but it takes too long."
    //
    // Correct, and the duration was only half of it. What the user waits through is the IDLE DELAY plus
    // the animation: 240 + 280 was more than half a second of nothing happening after the finger had
    // already stopped, and most of that half second was the delay, where there is no motion at all to
    // tell them anything is coming.
    //
    // 90 + 190 now. The delay only has to outlast the gap between scroll events inside one continuous
    // gesture — a fling still reports at least every 64 ms (see the panels' `scrollEventThrottle`), so 90
    // is comfortably above it and cannot re-show mid-fling, while being short enough to read as
    // immediate. The animation is then quick rather than deliberate: chrome returning to a list that has
    // already stopped is not a transition worth watching.
    chromeIdleRef.current = setTimeout(() => {
      chromeHiddenRef.current = false;
      chromeSV.value = withTiming(1, { duration: 190, easing: Easing.out(Easing.cubic) });
    }, 90);
  }, [chromeSV]);

  useEffect(() => () => { if (chromeIdleRef.current) clearTimeout(chromeIdleRef.current); }, []);

  // ── TRANSFORM ONLY, NO OPACITY ─────────────────────────────────────────────
  //
  // Both of these used to fade as well as slide, and that was a second reported symptom: the strips
  // "twitching" rather than moving cleanly.
  //
  // Fading was buying nothing. Each strip travels far enough to leave the container, which clips, so it
  // is fully hidden by the transform alone — the opacity was animating something already out of sight.
  // And it was actively costing: the bottom row contains a `NativeGlassView` (or a `BlurView`), and
  // animating opacity on a blurred surface makes iOS re-composite the backdrop every frame, which is a
  // well-known source of flicker on exactly these views. One property, on the UI thread, no blur
  // re-composite.
  const topChromeStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -(1 - chromeSV.value) * RECENT_ROW_H }],
  }));
  const bottomChromeStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - chromeSV.value) * (BOTTOM_CHROME_H + bottomInset) }],
  }));

  // Grid content padding. The top strip overlays the grid, so the grid has to start below it.
  const gridTopInset = hasRecents ? RECENT_ROW_H : 0;

  // The user's own GIFs, added by pasting a link. Field selectors so an unrelated store write cannot
  // re-render this panel while it is animating open.
  const customGifs = useCustomGifs((s) => s.items);
  const removeCustomGif = useCustomGifs((s) => s.remove);
  const [addOpen, setAddOpen] = useState(false);
  // Latches true on the first open and never goes back. See the long note at the render site: the sheet
  // has to outlive `addOpen === false` for its own slide-down to run.
  const [addMounted, setAddMounted] = useState(false);
  const openAddGif = useCallback(() => {
    triggerHaptic('light');
    setAddMounted(true);
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
          {/* Opaque backing. Under glass the panel itself is translucent, so this has to match the
              panel's own tint rather than a flat surface colour — otherwise the strip would be the one
              opaque band in an otherwise translucent sheet. */}
          <View
            style={[
              styles.recentFill,
              { backgroundColor: glassActive
                  ? (theme.isDark ? 'rgba(26,26,31,0.92)' : 'rgba(255,255,255,0.92)')
                  : theme.colors.background.elevated },
            ]}
            pointerEvents="none"
          />
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
              <GifPanel bare height={height} onSelect={onSelectGif} onLongPress={onSendGif || onCopyGif ? onLongPressGif : undefined} recentGifs={recentGifs} theme={theme} bottomInset={56 + bottomInset} topInset={gridTopInset} onScrollTick={onScrollTick} customGifs={customGifs} />
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
      {/* ── THE PREVIEW IS A SCREEN, NOT A PANEL OVERLAY ─────────────────────────
   
          Reported bluntly, and correctly: it appeared inside the GIF panel and it should appear in the
          middle of the SCREEN.
   
          It was `StyleSheet.absoluteFill` inside this component — and this component is the docked panel,
          roughly a keyboard's height at the bottom of the display. So "fill" meant "fill the panel": the
          sticker was squeezed into the same strip it was launched from, with the menu crammed under it.
          No amount of styling fixes that from in here; the overlay has to leave this view's coordinate
          space entirely, which is what a `Modal` does.
   
          Safe to use one here: `MediaPanel` is a docked View inside the chat screen, not itself a Modal, so
          this is not the nested-Modal trap that `EditProfileTabModal` documents. `AddGifModal` is the other
          branch and never open at the same time.
   
          Layout follows the screenshot: the sticker sits on its own, large, centred; the actions are a
          separate card BELOW it, aligned to the right rather than stretched across — a column of short
          labels reads better ragged-right under the image than centred beneath it. */}
      {preview ? (
        <Modal visible transparent animationType="none" onRequestClose={closePreview} statusBarTranslucent>
          {/* The clock, the battery and the rest go away while this is up.
   
              Asked for by comparison with iOS itself: hold content in any Apple app and the status bar
              leaves with everything else. This app already does it in its own long-press menus, and the
              sticker preview was the one that did not — which is what made it feel like a panel with a dim
              layer rather than a mode the phone had entered.
   
              `hidden` on the RN StatusBar rather than a themed style: there is nothing to theme against
              once the whole screen is at 78% black, and dimming a white clock still leaves a clock. */}
          <StatusBar hidden animated />
          <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          <Reanimated.View style={[StyleSheet.absoluteFill, styles.previewBackdrop, backdropStyle]}>
            <Pressable style={StyleSheet.absoluteFill} onPress={closePreview} />
          </Reanimated.View>

          <View style={styles.previewCenter} pointerEvents="box-none">
            <Reanimated.View style={[styles.previewStack, previewCardStyle]}>
              {/* The sticker itself, on nothing. No card behind it, so a cut-out sticker shows the dimmed
                  screen through its transparent parts instead of a panel-coloured rectangle — the same
                  reasoning as the chat bubble. */}
              {preview.kind === 'emoji' ? (
                <RNText style={styles.previewEmoji} allowFontScaling={false}>{preview.emoji}</RNText>
              ) : (
                /* ── THE SAME BYTES THE CELL IS ALREADY SHOWING ────────────────────
   
                    Asked for: hold a sticker and it should ENLARGE what is already on screen, not fetch
                    it again.
   
                    It was fetching again, and the URL is why. The grid cell renders
                    `stillUrl` with `noProxy`; this rendered `previewUrl` with the proxy left ON, so
                    `CachedImage` rewrote it through weserv at the default width. Two different URLs mean
                    two different expo-image cache keys, so holding a sticker started a cold network
                    fetch and an animated decode for an image whose bytes were already decoded a few
                    pixels away.
   
                    Matched to the cell exactly — same `stillUrl` fallback, same `noProxy` — so this is a
                    memory-cache hit and the sticker appears in the same frame the menu does.
   
                    `autoplay` is deliberately left on. The cell is a still frame on purpose (a grid of
                    animating GIFs saturates the UI thread); the preview is the one place motion is
                    wanted, and starting animation on already-cached bytes costs nothing extra. */
                <CachedImage
                  uri={(preview.item as any).stillUrl || preview.item.previewUrl}
                  style={styles.previewGif}
                  resizeMode="contain"
                  noProxy
                />
              )}

              {/* ── A MENU, NOT TWO BUTTONS ──────────────────────────────────────────
   
                  Asked for, with a Telegram screenshot: hold a sticker and get a list — Send, then Delete
                  if it is one I imported, then View pack.
   
                  Rows rather than the previous side-by-side pair, for the reason the screenshot shows: the
                  action count is now variable. A pack sticker has three actions and one of mine has four,
                  and two buttons cannot grow without either shrinking each other or wrapping. Rows also
                  put the labels in one reading column, which is why every OS context menu is built this
                  way.
   
                  "Send", not "Send later" — the Telegram screenshot has scheduling and this app has no
                  such concept, so copying the label would promise something that does not exist. */}
              {/* ── COMPACT, AND GLASS WHEN GLASS IS ON ──────────────────────────────
   
                  Two things were wrong. It had `minWidth: 210`, so it stretched to a width nothing in it
                  needed — the labels are two words each. Width comes from the content now, with only a
                  floor low enough to keep a two-row menu from collapsing to the size of "Send".
   
                  And it was a flat elevated surface while the rest of the app's chrome is liquid glass. It
                  sits over a dimmed screen with a sticker behind it, which is exactly the situation glass
                  is for — the same treatment as the switcher pill below and the viewer buttons. */}
              <View style={[styles.menu, glassActive ? null : { backgroundColor: theme.colors.background.elevated }]}>
                {glassActive ? (
                  <GlassBg
                    borderRadius={16}
                    glassStyle="regular"
                    interactive={false}
                    colorScheme={theme.isDark ? 'dark' : 'light'}
                    tintColor={theme.isDark ? 'rgba(28,28,32,0.72)' : 'rgba(255,255,255,0.72)'}
                  />
                ) : null}
                <StickerMenuRow
                  icon="send"
                  label={labels.send}
                  theme={theme}
                  onPress={() => {
                    if (preview.kind === 'emoji') onSendEmoji?.(preview.emoji);
                    else onSendGif?.(preview.item);
                    tearDownPreview();
                  }}
                />
                <StickerMenuRow
                  icon="copy"
                  label={labels.copy}
                  theme={theme}
                  onPress={() => {
                    if (preview.kind === 'emoji') onCopyEmoji?.(preview.emoji);
                    else onCopyGif?.(preview.item);
                    tearDownPreview();
                  }}
                />
                {/* Only for a sticker that came from an imported pack — the row is absent rather than
                    disabled, because there is nothing to view for a Giphy GIF or an emoji and a dead row
                    reads as a broken one. */}
                {preview.kind === 'gif' && (preview.item as any).packName ? (
                  <StickerMenuRow
                    icon="grid"
                    label={labels.viewPack}
                    theme={theme}
                    onPress={() => {
                      const name = (preview.item as any).packName as string;
                      tearDownPreview();
                      // Opens in Telegram itself when installed, in the browser otherwise — `openUrl`
                      // already makes that choice for every external link in the app.
                      void openUrl(`https://t.me/addstickers/${encodeURIComponent(name)}`);
                    }}
                  />
                ) : null}
                {/* Delete is offered ONLY for the user's own imports. A Giphy GIF is not theirs to remove,
                    and the `custom:` id prefix is the only marker that survives being persisted. */}
                {/* No `&& removeCustomGif` guard: it is a store action, so it is always defined, and tsc
                    flags the check as always-true. The `custom:` prefix is the real condition. */}
                {preview.kind === 'gif' && preview.item.id.startsWith('custom:') ? (
                  <StickerMenuRow
                    icon="trash-2"
                    label={labels.remove}
                    theme={theme}
                    destructive
                    onPress={() => {
                      const id = preview.item.id;
                      tearDownPreview();
                      // BOTH lists. The store owns existence; recents keeps a full copy of anything the
                      // user has sent, and cleaning only the store is what made a delete look like the
                      // sticker had moved to another slot. See the long note on `removeRecentGif`.
                      removeCustomGif(id);
                      onForgetGif?.(id);
                    }}
                  />
                ) : null}
              </View>
            </Reanimated.View>
          </View>
          </View>
        </Modal>
      ) : null}

      {/* Add-your-own-GIF dialog. Rendered last so it paints above the grids and the switcher, and
          mounted only while open - it owns a TextInput and a Modal, neither of which should exist
          in the tree of a picker that is usually just being scrolled. */}
      {/* ── LATCHED MOUNT, NOT `addOpen ? ... : null` ────────────────────────────
   
          Reported: tapping Cancel made this sheet vanish instantly instead of sliding down.
   
          The cause was one boolean doing two jobs. `addOpen` was BOTH the mount condition and the
          `visible` prop, so `setAddOpen(false)` removed `AddGifModal` — and with it the `SlideUpSheet`
          inside it — in the very same React commit that asked it to close. `SlideUpSheet` animates its
          exit from an effect branch that runs when `visible` goes false while still mounted; with the
          instance already gone there was nothing left to run it. The 250 ms slide-down existed the whole
          time and never got a chance to play.
   
          The giveaway was that dismissing by tapping the backdrop looked CORRECT: that path starts inside
          the sheet, so the animation finishes first and only then calls `onClose`. Only the in-sheet
          buttons were instant, which is precisely the asymmetry an unmount-before-animate produces.
   
          `mounted` only ever latches true, exactly like `ShareSheetHost` does for the share sheet — the
          one consumer in the app that already had to solve this. The original reason for the conditional
          still holds (this sheet owns a TextInput and a Modal that should not sit in the tree of a picker
          that is usually just being scrolled) and is preserved: nothing mounts until the first open. */}
      {addMounted ? (
        <AddGifModal visible={addOpen} onClose={closeAddGif} theme={theme} labels={labels.addGif} />
      ) : null}
    </View>
  );
}

/**
 * One row of the long-press sticker menu.
 *
 * Extracted rather than mapped over a config array, because the rows are conditional on different things
 * (is it mine, did it come from a pack) and an array would need those conditions expressed as filters over
 * data — more indirection than four call sites are worth.
 */
function StickerMenuRow({
  icon,
  label,
  theme,
  onPress,
  destructive,
}: {
  icon: string;
  label: string;
  theme: any;
  onPress: () => void;
  destructive?: boolean;
}) {
  const color = destructive ? '#FF3B30' : theme.colors.text.primary;
  return (
    <Pressable
      onPress={() => { triggerHaptic('light'); onPress(); }}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.menuRow,
        pressed ? { backgroundColor: theme.isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)' } : null,
      ]}
    >
      <Feather name={icon as any} size={17} color={color} />
      <RNText style={[styles.menuLabel, { color }]}>{label}</RNText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    overflow: 'hidden',
  },
  // Full-width rows inside the preview card. `alignSelf: stretch` so every row is the same width whatever
  // the longest label turns out to be after translation.
  // Its own card, sized to its content and pinned to the right of the stack. minWidth keeps it from
  // collapsing to the width of the shortest label when only two rows apply.
  // Width from the content, with a floor that only stops a two-row menu collapsing to the width of
  // its shortest label. overflow: hidden is required, not cosmetic: the glass layer is an absolutely
  // positioned child and would paint past the rounded corners without it.
  menu: { minWidth: 168, borderRadius: 16, paddingVertical: 4, paddingHorizontal: 4, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.22, shadowRadius: 14, elevation: 12 },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 11, paddingHorizontal: 10, borderRadius: 12 },
  // 15 -> 16.5. Reported as too small, and it was: these are the only labels on an otherwise empty
  // screen, so they carry none of the size pressure that justifies 15 inside a dense list.
  menuLabel: { fontSize: 16.5, fontWeight: '500' },
  // ABSOLUTE, so hiding it on scroll is a transform and not a relayout. The grids pad their content
  // by RECENT_ROW_H to compensate, exactly as they already do for the bottom switcher.
  recentRow: { position: 'absolute', top: 0, left: 0, right: 0, height: RECENT_ROW_H, borderBottomWidth: 0.5, justifyContent: 'center', zIndex: 2 },
  // Fills the strip so grid cells passing UNDERNEATH it are hidden.
  //
  // This is the artefact that was reported as the strip looking "see-through with the backing showing".
  // In normal flow it never needed a background — nothing was behind it. Making it absolute so it could
  // slide away without a relayout put the grid behind it, and an unfilled strip then showed emoji and
  // GIF thumbnails scrolling through the row of recents. Opaque, not translucent: a blur here would
  // still show motion through it, and motion behind a row of small static emoji is what made it read as
  // broken rather than layered.
  recentFill: { ...StyleSheet.absoluteFillObject },
  recentContent: { paddingHorizontal: 10, alignItems: 'center', gap: 2 },
  recentCell: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  recentEmoji: emojiTextStyle(26),
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
  // 0.5 -> 0.78. Asked for directly, and it is what makes the preview read as a MODE rather than a
  // dim layer: at half opacity the chat behind it stayed legible enough to keep competing for
  // attention. iOS's own long-press context menus go considerably darker than half.
  previewBackdrop: { backgroundColor: 'rgba(0,0,0,0.78)' },
  previewCenter: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  // The sticker and the menu are stacked, NOT wrapped in a shared card. lignItems: flex-end is
  // what puts the menu under the image on the right, as in the screenshot, while the image itself is
  // centred by previewGif's own alignment.
  previewStack: { alignItems: 'flex-end' },
  // 1.133 was too tight: see emojiTextStyle. At 120 pt the shortfall is ~20 px of trimmed glyph.
  previewEmoji: { ...emojiTextStyle(120), marginBottom: 14, alignSelf: 'center' },
  // No background: a cut-out sticker must show the dimmed screen through its transparent parts, not
  // a grey rectangle. Larger than before, because it now has a whole screen rather than a panel.
  previewGif: { width: 220, height: 220, marginBottom: 14, alignSelf: 'center' },
  previewActions: { flexDirection: 'row', gap: 10, marginTop: 2 },
  previewBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 14 },
  previewBtnText: { fontSize: 14, fontWeight: '700' },
});

export const MediaPanel = memo(MediaPanelComponent);