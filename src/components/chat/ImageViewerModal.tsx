import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { View, Pressable, StyleSheet, Dimensions, FlatList } from 'react-native';
import { Feather } from '@expo/vector-icons';
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
import { CachedImage } from '../ui/CachedImage';
import { ModalStatusBar } from '../ui/ModalStatusBar';
import { useTabBarStore } from '../../store/tabBarStore';
import { GlassBg, useLiquidGlassActive } from '../ui/LiquidGlass';

/**
 * One round control in the viewer's chrome — the close X, and every action the callers put in the
 * footer (edit, share, delete, pin).
 *
 * ── WHY IT IS SHARED ────────────────────────────────────────────────────────
 *
 * Asked for: "the edit, share and close buttons must support liquid glass."
 *
 * They did not, and the reason they did not is that there were four separate hand-written button
 * styles — the X in here, and a row each in the own-profile, other-profile and (soon) chat footers,
 * all using a flat `rgba(255,255,255,0.16)` circle. Adding glass to each would have been four
 * copies of the same branch, and the fourth would have drifted like the viewers themselves did.
 *
 * So the button is a component and the glass decision lives in it once. Callers pass an icon and a
 * handler; they cannot get this wrong or forget the glass path.
 *
 * ── THE APP-WIDE GLASS RULE, FOLLOWED ───────────────────────────────────────
 *
 * `GlassBg` goes BEHIND the icon as a SIBLING, never as a parent. The codebase states this rule in
 * several places (the chat's day-separator chip spells it out) and the reason is that the material
 * optically warps whatever it contains — an icon inside a GlassView reads as slightly distorted.
 *
 * Also note `overflow: hidden` is only applied on the flat path. Clipping a native glass view kills
 * the outward liquid morph on touch, which is the whole point of the interactive material.
 */
export function ViewerActionButton({
  icon,
  onPress,
  destructive = false,
  accessibilityLabel,
}: {
  icon: keyof typeof Feather.glyphMap;
  onPress: () => void;
  /** Tints the glyph red. Used by delete. */
  destructive?: boolean;
  accessibilityLabel?: string;
}) {
  const glassActive = useLiquidGlassActive();
  const color = destructive ? '#FF3B30' : '#FFFFFF';
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={[
        actionBtnStyles.base,
        glassActive
          ? null
          : {
              // The flat fallback. A destructive action keeps a red-tinted fill so it is
              // distinguishable at a glance without relying on the glyph colour alone.
              backgroundColor: destructive ? 'rgba(255,60,50,0.24)' : 'rgba(255,255,255,0.16)',
              overflow: 'hidden',
            },
      ]}
    >
      {glassActive ? (
        <GlassBg
          borderRadius={21}
          glassStyle="regular"
          interactive
          colorScheme="dark"
          // A faint red wash keeps delete readable as destructive through the material, which on
          // its own is colourless and would make every action look identical.
          tintColor={destructive ? 'rgba(255,60,50,0.22)' : undefined}
        />
      ) : null}
      <Feather name={icon} size={18} color={color} />
    </Pressable>
  );
}

const actionBtnStyles = StyleSheet.create({
  base: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

/**
 * Full-screen photo viewer for the chat.
 *
 * ── WHY IT IS ITS OWN COMPONENT ───────────────────────────────────────────────
 * It used to be inline JSX inside the chat screen, which is what made dragging it
 * feel awful. The pager's `renderItem`, `keyExtractor` and `getItemLayout` were
 * inline arrows, so EVERY re-render of the chat screen handed the viewer's FlatList
 * fresh identities and re-rendered all three mounted full-screen images. The chat
 * screen re-renders often (keyboard frames, reveal state, store pushes), and while
 * the viewer was open those re-renders were landing mid-gesture — so a drag was
 * competing with three image re-renders per frame.
 *
 * Extracted and memoized on primitives, with all three callbacks stable, the viewer
 * is now completely insulated: nothing the chat screen does re-renders it.
 *
 * ── ANIMATION ─────────────────────────────────────────────────────────────────
 * The old version relied on `Modal animationType="fade"`, which pops. Open and close
 * are now a Reanimated scale + backdrop fade on the UI thread, and the modal itself
 * mounts with no animation so the two never fight. Close waits for the exit to
 * finish before unmounting, so the image never disappears before the backdrop.
 *
 * Dragging down dismisses, tracking the finger with the backdrop fading out as it
 * goes — the interaction people expect from a photo viewer. All of it runs in
 * worklets, so it cannot be slowed by whatever JS is busy.
 *
 * ── CACHE ─────────────────────────────────────────────────────────────────────
 * `proxyWidth` is passed in by the caller so the viewer requests the SAME derivative
 * the chat bubbles already decoded. Without it the viewer asked for a different size,
 * which is a different cache key and therefore a fresh download + decode on open.
 */

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

/** Drag further than this (or flick faster) and the viewer dismisses. */
const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 900;

/**
 * ── TWO DETENTS: FLOATING CARD, THEN FULL BLEED ────────────────────────────────
 *
 * Requested, three times, always described from the same flow — tap a photo in a chat: it should
 * come up from the bottom NOT touching any screen edge, and dragging it up should expand it until
 * it does. Dragging back down returns it to the floating size, and further down dismisses.
 *
 * ── WHY THE COLLAPSED DETENT IS A SCALE AND NOT A HEIGHT ──────────────────────
 *
 * The obvious implementation is to inset the container — animate its width, its bottom offset and
 * its corner radius. That cannot work HERE, and the reason is the pager: the photos live in a
 * horizontal `FlatList` with `pagingEnabled` and a `getItemLayout` that reports a fixed
 * `SCREEN_W` per page. Page width is baked into both the layout callback and the paging maths, so
 * an animated container width desynchronises the snap offsets from the pages and paging lands
 * between two photos.
 *
 * A uniform `scale` gets the same picture with none of that. Layout is untouched — every page is
 * still exactly `SCREEN_W`, `getItemLayout` still true, paging still exact — and the whole viewer
 * is simply drawn smaller. At 0.92 that leaves a gap on all four sides at once, which is the
 * "doesn't touch the edges, not at the bottom and not at the sides" part, and it is a transform, so
 * it is free and runs on the UI thread with the drag.
 *
 * It also means there is no separate "half height" state to maintain: one number moves the viewer
 * between floating and full bleed.
 *
 * ── WHY THE BACKDROP HAS TO LIGHTEN WITH IT ───────────────────────────────────
 *
 * The backdrop is 95 % black across the whole screen. Scaling the content down inside that would
 * put black gaps around a black-framed photo — the card would be invisible as a card. So the
 * backdrop dims LESS at the collapsed detent, and the content view paints its own opaque surface
 * with the rounded corners on it. That is what makes the gap read as a gap.
 */
const COLLAPSED_SCALE = 0.92;
const COLLAPSED_CORNER = 28;
/** Vertical clearance the collapsed scale produces, used to keep the chrome inside the card. */
const CARD_GAP_Y = (SCREEN_H * (1 - COLLAPSED_SCALE)) / 2;
/** Upward travel that expands the floating card to full bleed. */
const EXPAND_DISTANCE = 56;
/** Downward travel that collapses a full-bleed viewer back to the floating card. */
const COLLAPSE_DISTANCE = 56;

export interface ImageViewerModalProps {
  /** Non-null opens the viewer. */
  payload: { images: string[]; index: number } | null;
  onClose: () => void;
  topInset: number;
  /**
   * Proxy width to request, matched to what the bubbles used so the images come
   * from the memory cache instead of being re-fetched at a new size.
   */
  proxyWidth: number;
  /**
   * Chrome drawn ABOVE the photo, pinned to the top. Used by the profile viewers for the author
   * row (avatar, name, date). Rendered as a sibling of the pager, so it never inherits the drag's
   * translate or scale, and it fades on the same curve as the close button.
   *
   * A slot rather than props-per-field on purpose: the three callers want visibly different
   * headers (own profile resolves the original author for reposts, the other-profile route does
   * not), and encoding all of that here would mean this component knowing about posts.
   */
  header?: React.ReactNode;
  /**
   * Chrome drawn BELOW the photo, pinned to the bottom. Used for the edit / share / delete row.
   *
   * Callers pass a bare row — this component supplies the safe-area padding and the fade, and
   * deliberately paints NO surface behind it. The profile viewers used to wrap their buttons in a
   * translucent pill, which put a second background behind buttons that already have their own
   * circular fills; reported as "there is another container in the bottom area that should not be
   * there".
   */
  footer?: React.ReactNode;
  /** Bottom safe-area inset, for the footer's padding. */
  bottomInset?: number;
  /**
   * Allow pinch-to-zoom. Off for the chat (bubbles open a pager, not a zoomable canvas) and on
   * for the profile viewers, which had `maximumZoomScale` before this component replaced them —
   * losing that would have been a regression, so it is a capability of the shared viewer now.
   */
  zoomable?: boolean;
}

function ImageViewerModalComponent({
  payload,
  onClose,
  topInset,
  proxyWidth,
  header,
  footer,
  bottomInset = 0,
  zoomable = false,
}: ImageViewerModalProps) {
  // Kept mounted for the length of the exit animation so the content does not blink
  // out before the backdrop has faded.
  const [mounted, setMounted] = useState(!!payload);
  // Frozen copy of the payload, so a parent clearing it mid-exit cannot empty the
  // pager while it is still on screen.
  const [shown, setShown] = useState(payload);

  const enter = useSharedValue(0);
  const dragY = useSharedValue(0);
  /**
   * ── PRESENTATION TRAVEL, SEPARATE FROM THE DRAG ───────────────────────────
   *
   * Reported: the viewer "closes too abruptly"; it should rise smoothly from the bottom and go
   * back down the same way.
   *
   * Two things were wrong, and only one of them was the duration.
   *
   * 1. THE OPEN NEVER ROSE. `enter` drove scale + opacity only, so the photo materialised in
   *    place. There was no upward motion to be smooth about.
   *
   * 2. THE EASING PAIR WAS INVERTED ON EXIT. Travel used `Easing.out(cubic)` — fastest on the
   *    very first frames, then decelerating — while opacity used `Easing.in(cubic)`, which
   *    barely moves at first. So on close the photo LURCHED away at full opacity and then
   *    blinked out at the end. That reads as a snap, which is exactly the complaint. Departures
   *    want an accelerating curve (`Easing.in`): start gently, gather speed, leave. Arrivals want
   *    the decelerating one (`Easing.out`): arrive fast, settle soft.
   *
   * `slide` is the presentation offset and is the ONLY channel that carries the viewer on and off
   * screen. `dragY` stays what it was — the live finger offset — so the two never have to encode
   * each other. The flick hands its accumulated `dragY` over to `slide` and zeroes itself, which
   * keeps the motion continuous across the handover instead of adding two offsets together and
   * overshooting by however far the finger had travelled.
   */
  const slide = useSharedValue(SCREEN_H);
  /**
   * 0 = floating card clear of every edge, 1 = full bleed. Snapped, never left in between, so the
   * viewer always rests at one of the two detents. See the constants above for why this is a scale.
   */
  const detent = useSharedValue(0);
  // ── ZOOM ──────────────────────────────────────────────────────────────────
  //
  // The profile viewers this component replaces had `maximumZoomScale={3}` on a native
  // ScrollView, so dropping zoom would have been a regression. Reimplemented in worklets instead
  // of nesting a zoom ScrollView, because a native scroll view inside the pan would fight it for
  // the same vertical drag and the resolution differs per platform.
  //
  // `zoom` is also what keeps the two interactions from colliding: while the photo is enlarged a
  // vertical drag means "look at another part of this photo", not "dismiss". The pan below reads
  // this value and does nothing while zoomed, so the dismiss can never fire under the user's
  // fingers as they inspect a photo. Panning a zoomed photo is `zoomPanX/Y`.
  const zoom = useSharedValue(1);
  const zoomPanX = useSharedValue(0);
  const zoomPanY = useSharedValue(0);
  // JS mirror of "is the photo enlarged", used only to switch the pager off. A shared value cannot
  // drive a plain prop, and this flips at most twice per zoom gesture (in, then out) rather than
  // per frame, so it is not a render cost. Without it, the horizontal FlatList keeps its own scroll
  // gesture while zoomed and competes with dragging the enlarged photo sideways.
  const [zoomedJS, setZoomedJS] = useState(false);

  useEffect(() => {
    if (payload) {
      setShown(payload);
      setMounted(true);
      dragY.value = 0;
      // Reset zoom on every open, so a photo closed while enlarged does not reopen enlarged.
      zoom.value = 1;
      zoomPanX.value = 0;
      zoomPanY.value = 0;
      // Rise from the bottom edge. `Easing.out` for an arrival, and a touch longer than the exit
      // because coming in is the moment the user is looking at — 300 ms reads as a glide, while the
      // old 220 ms fade read as a pop.
      slide.value = SCREEN_H;
      slide.value = withTiming(0, { duration: 300, easing: Easing.out(Easing.cubic) });
      // Always open at the floating detent, so a photo left expanded does not reopen expanded.
      detent.value = 0;
      // Opacity finishes well BEFORE the travel does, and that gap is the point.
      //
      // At 200 ms against a 300 ms rise the photo was still fading through two thirds of its own
      // movement, so the rise was there but invisible — reported as "it opens abruptly", because a
      // fade is all that could be seen of it. At 160 ms the card is solid for roughly half the
      // travel, so what the eye follows is an object moving rather than an image appearing.
      enter.value = withTiming(1, { duration: 160, easing: Easing.out(Easing.cubic) });
    } else if (mounted) {
      // Parent-driven close (e.g. the edit action navigating away) gets the SAME downward exit as
      // the X and the flick, so there is no third way for a photo to leave the screen.
      slide.value = withTiming(SCREEN_H, { duration: 260, easing: Easing.in(Easing.cubic) });
      enter.value = withTiming(0, { duration: 260, easing: Easing.in(Easing.cubic) }, (finished) => {
        if (finished) runOnJS(setMounted)(false);
      });
    }
    // `mounted` is read, not depended on: adding it would re-run the exit on the
    // state change the exit itself causes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload, enter, dragY, slide, detent]);

  /**
   * Close by flying the photo DOWNWARD while it shrinks, then hand back to the parent.
   *
   * Reported: "when I just tap the X and it disappears, the photo simply vanishes. I'd like it to
   * disappear downward — as if it shrank and went away smoothly but quickly, downward. Everywhere."
   *
   * It used to call `onClose()` immediately. The parent then cleared the payload, and the only
   * animation left was `enter` fading to 0 — a fade with a faint 0.92 scale, no travel. So the photo
   * did just vanish.
   *
   * Now the X takes the SAME exit the drag-dismiss takes, which is the point: dismissing by flick
   * and dismissing by button should not be two different animations. `dragY` runs to 60 % of the
   * screen rather than a full screen — the photo is invisible well before that, so the extra travel
   * would only make the timing feel slow — and `contentStyle` already multiplies in a shrink as
   * `dragY` grows and `enter` falls, which is where "as if it shrank" comes from at no extra cost.
   *
   * 200 ms: fast enough to read as immediate, long enough to read as motion rather than a cut.
   *
   * `onClose` fires from the completion callback, not up front. That ordering matters — clearing the
   * payload first would make the effect below run its own exit at the same time, and two animations
   * driving `enter` would fight. By the time the parent hears about it, `mounted` is already false,
   * so that branch is a no-op.
   */
  const requestClose = useCallback(() => {
    // Full screen height, not 60 %. At 60 % the photo came to rest still partly on screen, so it
    // depended on the unmount to finish disappearing. Travelling the whole way means the exit is
    // complete on its own.
    //
    // Now on `slide` with an ACCELERATING curve, and 260 ms rather than 200. The old pairing
    // (`dragY` + `Easing.out`) put peak speed on frame one, which is what made this feel like a
    // snap regardless of how long the animation nominally lasted.
    slide.value = withTiming(SCREEN_H, { duration: 260, easing: Easing.in(Easing.cubic) });
    enter.value = withTiming(0, { duration: 260, easing: Easing.in(Easing.cubic) }, (finished) => {
      if (finished) {
        runOnJS(setMounted)(false);
        runOnJS(onClose)();
      }
    });
  }, [slide, enter, onClose]);

  /**
   * Hand the close back to the parent WITHOUT animating anything.
   *
   * Used by the drag dismiss, and the distinction matters — it is the fix for a reported bug:
   * "sometimes when I swipe UP the photo disappears, then abruptly comes back down, then disappears
   * again."
   *
   * The gesture used to call `requestClose`, and `requestClose` became a downward fly-out in the
   * previous change. So a swipe UP played its own upward exit to completion and then `requestClose`
   * started a SECOND animation, downward, from wherever `dragY` had landed. Two exits for one
   * dismissal, in opposite directions.
   *
   * The gesture already owns its exit — it animates `dragY` in the direction of travel and drives
   * `enter` to 0 itself. All it needs from this is to tell the parent, which is all this does.
   */
  const notifyClosed = useCallback(() => {
    onClose();
  }, [onClose]);

  // ── HIDE THE TAB BAR WHILE OPEN, DELIBERATELY ─────────────────────────────
  //
  // Reported: "I tap a photo in a profile and for some reason the bottom navigation disappears."
  //
  // It was disappearing by ACCIDENT. Nothing asked the tab bar to go; the viewer is an in-tree
  // overlay at `zIndex: 3000` and it simply happened to paint over a bar that is rendered outside
  // the screen's tree. That is not a behaviour to rely on — it depends on z-order between two
  // subtrees that know nothing about each other, it differs between a tab screen and a pushed
  // screen, and it means the bar is still mounted and still hit-testable underneath a photo.
  //
  // So it is now explicit. `tabBarStore` exists for exactly this ("lets a screen temporarily take
  // over the bottom of the display") and hides by translating the bar off-screen rather than fading
  // it — which matters, because `expo-glass-effect` stops rendering glass entirely at opacity 0.
  // The bar now slides away instead of being occluded.
  //
  // Restored in the cleanup, which is what makes it safe: whether the viewer closes by the X, by a
  // drag, or because the whole screen unmounted mid-view, the bar comes back. That is the failure
  // the store's own documentation warns about ("screens MUST restore visibility on unmount/blur ...
  // so backing out can never leave the app with no tab bar").
  //
  // Keyed on `mounted`, not on `payload`, so the bar stays away for the whole exit animation and
  // does not slide back up underneath a photo that is still on screen.
  useEffect(() => {
    if (!mounted) return;
    const setHidden = useTabBarStore.getState().setHidden;
    setHidden(true);
    return () => setHidden(false);
  }, [mounted]);

  // Backdrop opacity folds in the drag so pulling the photo down reveals the chat
  // behind it, rather than dimming at full strength until the very last frame.
  const backdropStyle = useAnimatedStyle(() => {
    const dragFade = interpolate(Math.abs(dragY.value), [0, SCREEN_H * 0.5], [1, 0], Extrapolation.CLAMP);
    // Lighter at the floating detent. At full strength the 95 % black would fill the gap the
    // collapsed scale opens up, and a black card on a black field is not a card — the chat has to
    // stay faintly visible around it for the float to read at all.
    const detentDim = interpolate(detent.value, [0, 1], [0.62, 1], Extrapolation.CLAMP);
    return { opacity: enter.value * dragFade * detentDim };
  });

  const contentStyle = useAnimatedStyle(() => ({
    // ── THE PHOTO FADES. IT DID NOT BEFORE. ─────────────────────────────────
    //
    // Reported: tapping the X slides the photo down, then it "stops for a second or two" and only
    // then disappears.
    //
    // This style had transforms only — no opacity at all. So the photo stayed 100 % opaque for the
    // whole exit, ended up parked partway down the screen where it was still visible, and did not
    // actually vanish until `runOnJS(setMounted)(false)` reached the JS thread. When that thread is
    // busy the callback waits, and the photo sits frozen mid-screen for exactly as long as the wait —
    // which is the pause, and why its length varied.
    //
    // Binding opacity to `enter` means the exit is finished visually by the time the animation ends,
    // whenever the unmount happens to land. A late unmount is now invisible instead of being the
    // thing the user waits for.
    opacity: interpolate(enter.value, [0, 1], [0, 1], Extrapolation.CLAMP),
    transform: [
      // Three independent vertical offsets, summed: the presentation slide (on/off screen), the
      // live finger drag, and the pan of an enlarged photo. Keeping them separate is what lets the
      // flick hand off to the slide without the two double-counting.
      { translateY: slide.value + dragY.value + zoomPanY.value },
      { translateX: zoomPanX.value },
      // A small scale-in on open, and a slight shrink while dragging away, which is
      // what makes the dismiss read as "throwing it back into the chat".
      {
        scale:
          interpolate(enter.value, [0, 1], [0.92, 1], Extrapolation.CLAMP) *
          interpolate(Math.abs(dragY.value), [0, SCREEN_H * 0.6], [1, 0.85], Extrapolation.CLAMP) *
          // The detent, multiplied in with the rest. A uniform scale rather than an inset container
          // because the pager's `getItemLayout` reports a fixed SCREEN_W per page — see the note on
          // COLLAPSED_SCALE. Layout stays exact, only the drawing shrinks.
          interpolate(detent.value, [0, 1], [COLLAPSED_SCALE, 1], Extrapolation.CLAMP) *
          zoom.value,
      },
    ],
    // Rounded while floating, square once it reaches the edges. A radius against the bezel is what
    // makes a full-bleed surface look like it is still a card, so it has to go at the far detent.
    borderRadius: interpolate(detent.value, [0, 1], [COLLAPSED_CORNER, 0], Extrapolation.CLAMP),
  }));

  // ── CHROME FADE — THE FIX FOR THE "X DISSOLVES WITH AN ARTIFACT" REPORT ────
  //
  // The close button used to be a plain `Pressable` sibling with no animation at all. Two visible
  // consequences, both reported:
  //
  //   While dragging, it stayed fully opaque and pinned in the corner while the backdrop faded to
  //   nothing — so a solid white pill floated over the chat showing through behind it.
  //
  //   On dismissal it did not animate out. It vanished the instant `mounted` flipped: a hard
  //   one-frame cut at the END of the 180 ms exit, over a backdrop that had already gone. That cut,
  //   landing on the same frame as `ModalStatusBar` unmounting, is the artifact.
  //
  // Now every piece of chrome — close button, header, footer — shares this style. It fades over the
  // FIRST 80 pt of drag rather than half a screen, so the controls are gone well before the photo
  // is, and multiplies by `enter` so they also fade on open and on a button-driven close.
  //
  // Deliberately NOT folded into `contentStyle`: chrome must not inherit the photo's translate,
  // scale or zoom. It stays put and fades; only the photo moves.
  // ── DIRECTIONAL CHROME ────────────────────────────────────────────────────
  //
  // Asked for: "when I open a GIF, the X appears from the top downward, and the elements at the
  // bottom appear from the bottom upward."
  //
  // So the fade is shared but the travel is not: chrome enters FROM THE EDGE IT LIVES ON. Both
  // slides are driven by the same `enter` value that drives the photo's scale-in, so the whole
  // opening reads as one movement instead of three things starting at once.
  //
  // The drag fade stays common to both (first 80 pt), because while dragging the photo the controls
  // should get out of the way together — a header that lingered while the footer left would look
  // like a glitch, not a hierarchy.
  //
  // Neither is folded into `contentStyle`: chrome must not inherit the photo's translate, scale or
  // zoom. It arrives, sits still, and fades.
  // Top chrome (close button, author row) slides DOWN into place — from -22 pt to 0.
  const topChromeStyle = useAnimatedStyle(() => ({
    opacity:
      enter.value *
      interpolate(Math.abs(dragY.value), [0, 80], [1, 0], Extrapolation.CLAMP),
    transform: [
      {
        translateY:
          interpolate(enter.value, [0, 1], [-22, 0], Extrapolation.CLAMP) +
          // Follow the card's top edge inward while floating. The chrome is positioned against the
          // SCREEN, not against the scaled content, so without this the author row and the X would
          // sit out in the dimmed margin above the card and look detached from it.
          interpolate(detent.value, [0, 1], [CARD_GAP_Y, 0], Extrapolation.CLAMP),
      },
    ],
  }));

  // Bottom chrome (action row) slides UP into place — from +22 pt to 0.
  const bottomChromeStyle = useAnimatedStyle(() => ({
    opacity:
      enter.value *
      interpolate(Math.abs(dragY.value), [0, 80], [1, 0], Extrapolation.CLAMP),
    transform: [
      {
        translateY:
          interpolate(enter.value, [0, 1], [22, 0], Extrapolation.CLAMP) -
          // Mirror of the top chrome: up, to stay inside the floating card's bottom edge.
          interpolate(detent.value, [0, 1], [CARD_GAP_Y, 0], Extrapolation.CLAMP),
      },
    ],
  }));

  // Read from `shown` rather than the `images` local further down: this memo runs during render at
  // the point it appears, and `images` is declared below it, so referencing it here would be a
  // temporal-dead-zone error.
  const isPager = (shown?.images?.length ?? 0) > 1;

  const dismissGesture = useMemo(
    () => {
      const g = Gesture.Pan()
        // ── WHY THESE NUMBERS CHANGED ───────────────────────────────────────────────────
        //
        // Reported: "it conflicts with something — sometimes I just cannot drag the photo up or
        // down."
        //
        // `failOffsetX([-20, 20])` was the conflict. It CANCELS the gesture as soon as the finger
        // has moved 20 pt horizontally. A real vertical swipe on a phone is never vertical: it
        // arcs, and 20 pt of sideways drift over a full-screen swipe is completely ordinary. So
        // the dismiss died mid-drag, at random, depending on how straight the swipe happened to
        // be. That is the intermittency.
        //
        // The bound existed to protect the horizontal pager. But it only needs protecting when
        // there is something to page TO — and in a profile there is usually one photo, so the
        // pager had nothing to do while still breaking the drag. It is now applied only for a
        // multi-image payload, and widened to 40 pt there, which still distinguishes a deliberate
        // horizontal swipe from vertical drift.
        //
        // `activeOffsetY` tightened 14 → 12 so the drag takes hold slightly sooner, which makes
        // the photo feel attached to the finger from the start rather than after a dead zone.
        .activeOffsetY([-12, 12])
        // `onChange`, not `onUpdate`: its payload carries the per-frame deltas (`changeX/changeY`)
        // as well as the cumulative translation, and the zoomed branch below needs deltas so the
        // photo accumulates movement instead of snapping back to the gesture's origin each frame.
        .onChange((e) => {
          // While zoomed, a drag MOVES THE PHOTO instead of dismissing — otherwise inspecting an
          // enlarged photo would throw the viewer away under the user's finger.
          if (zoom.value > 1.01) {
            zoomPanX.value += e.changeX;
            zoomPanY.value += e.changeY;
            return;
          }
          dragY.value = e.translationY;
        })
        .onEnd((e) => {
          if (zoom.value > 1.01) return;

          // ── THE DETENT GETS FIRST REFUSAL ON THE GESTURE ────────────────────────────
          //
          // Order matters here. The dismiss test used to be the only test, so ANY sufficient drag
          // ended the viewer. With two detents there is a nearer meaning for the same movement:
          // pulling a floating card UP expands it, and pulling a full-bleed one DOWN shrinks it
          // back. Only a drag that has nowhere left to go dismisses.
          //
          // Both branches spring `dragY` back to 0 so the card returns to rest under the finger's
          // release rather than staying wherever it was let go.
          const d = e.translationY;
          if (detent.value < 0.5) {
            // Floating → expand on a pull upward. Down still dismisses, below.
            if (d < -EXPAND_DISTANCE || e.velocityY < -700) {
              detent.value = withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) });
              dragY.value = withSpring(0, { damping: 22, stiffness: 240, mass: 0.7 });
              return;
            }
          } else if (d > COLLAPSE_DISTANCE && d < DISMISS_DISTANCE * 2) {
            // Full bleed → collapse on a moderate pull downward. A long pull falls through to the
            // dismiss, so the gesture stays continuous: a little down shrinks, a lot down closes.
            detent.value = withTiming(0, { duration: 260, easing: Easing.out(Easing.cubic) });
            dragY.value = withSpring(0, { damping: 22, stiffness: 240, mass: 0.7 });
            return;
          }

          const far = Math.abs(e.translationY) > DISMISS_DISTANCE;
          const fast = Math.abs(e.velocityY) > DISMISS_VELOCITY;
          if (far || fast) {
            // Continue in the direction of travel, then hand back to the parent.
            //
            // ── THE FLICK STAYS ON `dragY`. MY HANDOVER CAUSED A REGRESSION. ──────────
            //
            // Reported: swiping the photo up or down made the chrome (save, edit, avatar, X)
            // REAPPEAR for an instant and only then vanish.
            //
            // I had written a handover here — move the accumulated `dragY` onto `slide`, then zero
            // `dragY` in the same frame — out of a worry about double-counting the two offsets. The
            // worry was unfounded: on this path `slide` is already at rest (0), so animating `dragY`
            // straight to the target never summed anything.
            //
            // What the handover DID do was break the chrome. Chrome opacity is
            // `enter * interpolate(|dragY|, [0, 80], [1, 0])` — it fades as the finger pulls the
            // photo away, which is the fix for the "solid pill floating over the chat" report. So
            // `dragY.value = 0` drove that interpolation from ~0 back to 1: the chrome jumped to FULL
            // opacity at the moment of release, then faded out again on `enter` over 180 ms. One
            // assignment, two visible events, exactly the flash described.
            //
            // Lesson worth keeping: `dragY` is not just a position, it is the input to two other
            // styles. Resetting it is never free.
            //
            // `Easing.out` is correct here and only here: the finger already supplied the
            // acceleration, so the throw should decay rather than accelerate a second time. That is
            // why the button close uses the opposite curve — it has no gesture to inherit speed from.
            const target = e.translationY >= 0 ? SCREEN_H : -SCREEN_H;
            dragY.value = withTiming(target, { duration: 180, easing: Easing.out(Easing.cubic) });
            enter.value = withTiming(0, { duration: 180 }, (finished) => {
              if (finished) {
                runOnJS(setMounted)(false);
                // `notifyClosed`, NOT `requestClose` — see the note on `notifyClosed`. Calling the
                // animating one here played a second, downward exit after an upward swipe.
                runOnJS(notifyClosed)();
              }
            });
          } else {
            dragY.value = withSpring(0, { damping: 20, stiffness: 260, mass: 0.7 });
          }
        });
      // Only guard against the pager when a pager actually exists — see the note above.
      if (isPager) g.failOffsetX([-40, 40]);
      return g;
    },
    [dragY, enter, notifyClosed, zoom, zoomPanX, zoomPanY, isPager, detent],
  );

  /**
   * Pinch to zoom, composed SIMULTANEOUSLY with the pan so a two-finger gesture is not swallowed by
   * the drag. Snaps back to 1 (and recentres) when released below a threshold, so the photo cannot
   * be left slightly and permanently off-centre — and clamps at 4x so a hard pinch cannot blow the
   * bitmap up past anything useful.
   */
  const pinchGesture = useMemo(
    () =>
      Gesture.Pinch()
        .onUpdate((e) => {
          zoom.value = Math.min(Math.max(e.scale, 0.6), 4);
        })
        .onEnd(() => {
          if (zoom.value < 1.05) {
            zoom.value = withSpring(1, { damping: 20, stiffness: 240 });
            zoomPanX.value = withSpring(0, { damping: 20, stiffness: 240 });
            zoomPanY.value = withSpring(0, { damping: 20, stiffness: 240 });
            runOnJS(setZoomedJS)(false);
          } else {
            runOnJS(setZoomedJS)(true);
          }
        }),
    [zoom, zoomPanX, zoomPanY],
  );

  /**
   * Double-tap toggles between fit and 2x. The gesture people reach for before they try to pinch,
   * and it costs one composed recogniser.
   */
  const doubleTapGesture = useMemo(
    () =>
      Gesture.Tap()
        .numberOfTaps(2)
        .onEnd(() => {
          if (zoom.value > 1.01) {
            zoom.value = withSpring(1, { damping: 20, stiffness: 240 });
            zoomPanX.value = withSpring(0, { damping: 20, stiffness: 240 });
            zoomPanY.value = withSpring(0, { damping: 20, stiffness: 240 });
            runOnJS(setZoomedJS)(false);
          } else {
            zoom.value = withSpring(2, { damping: 20, stiffness: 240 });
            runOnJS(setZoomedJS)(true);
          }
        }),
    [zoom, zoomPanX, zoomPanY],
  );

  // ── ALL THREE SIMULTANEOUS — NOT Exclusive ────────────────────────────────
  //
  // Reported, after the previous fix: "the up/down gesture still doesn't work on the first try. It
  // works, but as if not the first time."
  //
  // This composition was the cause. It used to be
  // `Gesture.Exclusive(doubleTap, Simultaneous(pan, pinch))`, and `Exclusive` means STRICT PRIORITY:
  // the double-tap is offered the touch first, and the pan is not allowed to activate until the
  // double-tap has definitively FAILED. A double-tap only fails once the window for the second tap
  // has expired — so the very first drag after opening was held hostage for that timeout, then
  // discarded because the finger had already moved. Try again and the recogniser is warm, so it
  // works. Exactly "not the first time".
  //
  // Simultaneous removes the wait: every recogniser evaluates the touch independently. They cannot
  // fight, because their activation conditions are disjoint by construction — the pan needs 12 pt of
  // vertical travel before it activates, and a double-tap that moved 12 pt is not a double-tap. The
  // pinch needs a second finger, which neither of the others accepts.
  const composedGesture = useMemo(
    () =>
      zoomable
        ? Gesture.Simultaneous(dismissGesture, pinchGesture, doubleTapGesture)
        : dismissGesture,
    [zoomable, doubleTapGesture, dismissGesture, pinchGesture],
  );

  // ── Stable pager callbacks ────────────────────────────────────────────────
  const images = shown?.images ?? [];

  const keyExtractor = useCallback((uri: string, i: number) => uri + i, []);

  const getItemLayout = useCallback(
    (_: unknown, index: number) => ({ length: SCREEN_W, offset: SCREEN_W * index, index }),
    [],
  );

  const renderItem = useCallback(
    ({ item }: { item: string }) => <ViewerPage uri={item} proxyWidth={proxyWidth} />,
    [proxyWidth],
  );

  if (!mounted || !shown) return null;

  // NOTE: not a native `Modal`. A Modal here would put the viewer in a separate
  // native window, where the Reanimated drag and the chat screen's gesture handler
  // root do not share a coordinate space — and it would re-introduce the platform
  // present/dismiss animation we are replacing. An in-tree absolute overlay with a
  // high zIndex gives the same visual result and keeps one gesture root.
  return (
    <View style={styles.host} pointerEvents="auto">
      <ModalStatusBar />
      <Reanimated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]} />

      <GestureDetector gesture={composedGesture}>
        {/* `contentSurface` is what turns the scaled-down content into a CARD: an opaque fill so the
            floating detent has a surface of its own, and `overflow: hidden` so the animated
            `borderRadius` in `contentStyle` actually clips the pager at the corners instead of the
            radius being drawn under a square photo. */}
        <Reanimated.View style={[StyleSheet.absoluteFill, styles.contentSurface, contentStyle]}>
          <FlatList
            data={images}
            horizontal
            pagingEnabled
            initialScrollIndex={Math.min(shown.index, Math.max(0, images.length - 1))}
            getItemLayout={getItemLayout}
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            showsHorizontalScrollIndicator={false}
            style={styles.pager}
            // The second half of the "sometimes I cannot drag the photo" conflict.
            //
            // A horizontal FlatList keeps its own scroll recogniser whether or not it has anywhere
            // to scroll, and that recogniser competes with the pan for the same touch. With ONE
            // image there is nothing to page to, so it was pure interference; while ZOOMED, a
            // sideways drag should move the enlarged photo, not flip to the next one.
            //
            // Off in both cases, so the pan is the only recogniser for the touch exactly when it
            // should be, and paging still works normally for a multi-image payload at 1x.
            scrollEnabled={isPager && !zoomedJS}
            // Three mounted pages at most: the one on screen and one either side.
            initialNumToRender={1}
            maxToRenderPerBatch={1}
            windowSize={3}
            removeClippedSubviews
          />
        </Reanimated.View>
      </GestureDetector>

      {/* Caller-supplied top chrome (author, date). Sits BELOW the close button in z-order and is
          inset on the right so it can never run under it. */}
      {header ? (
        <Reanimated.View
          style={[styles.header, { top: topInset + 12 }, topChromeStyle]}
          pointerEvents="box-none"
        >
          {header}
        </Reanimated.View>
      ) : null}

      {/* Caller-supplied bottom chrome (actions). NO surface is painted behind it — see the
          `footer` prop's note. The safe-area padding lives here so callers pass a bare row. */}
      {footer ? (
        <Reanimated.View
          style={[styles.footer, { paddingBottom: bottomInset + 20 }, bottomChromeStyle]}
          pointerEvents="box-none"
        >
          {footer}
        </Reanimated.View>
      ) : null}

      {/* Wrapped in an animated view so it fades WITH the drag and WITH the exit, instead of being
          cut off in one frame at the end — the reported dissolve artifact. */}
      <Reanimated.View style={[styles.closeBtnWrap, { top: topInset + 12 }, topChromeStyle]}>
        {/* Same component as the footer actions, so the X picks up liquid glass along with them
            rather than being the one control that stayed flat. */}
        <ViewerActionButton icon="x" onPress={requestClose} />
      </Reanimated.View>
    </View>
  );
}

/**
 * One page. Memoized on its own props so paging never re-renders its neighbours,
 * and `contain` inside a full-screen box so tall and wide photos both fit without
 * the caller having to know the aspect ratio.
 */
const ViewerPage = memo(function ViewerPage({ uri, proxyWidth }: { uri: string; proxyWidth: number }) {
  return (
    <View style={styles.page}>
      {/* ── `progressive`: THE VIEWER PAINTS WHAT IS ALREADY DECODED ──────────────
   
          Reported for comments: the GIF is on screen, you tap it, and it loads again before appearing.
   
          The cause is not in this component, it is in what the cache key contains. `CachedImage` gives
          expo-image the asset routed through the proxy at the requested width, so the WIDTH IS PART OF
          THE KEY — and a viewer asking for more resolution than the inline thumbnail used can only ever
          miss. Measured: a comment GIF inline is `width: 160` with no `proxyWidth`, so `w=320`, while
          this viewer is handed `proxyWidth = SCREEN_WIDTH`, so `w=780`. Two keys, one asset.
   
          Matching the widths would fix the miss and ruin the viewer — a 320 px derivative stretched
          across the display. So the derivative already in memory is painted on the FIRST frame via
          expo-image's own `placeholder`, and the sharper one replaces it when it arrives. Same picture,
          more pixels, so the swap is invisible; the perceived open cost becomes one frame.
   
          Nothing here needs to know which derivative that is: every surface records its completed loads
          through `CachedImage`, so this works for chat, comments and both profile screens at once. See
          `src/services/mediaVariants.ts`. */}
      <CachedImage uri={uri} style={styles.image} resizeMode="contain" proxyWidth={proxyWidth} progressive />
    </View>
  );
});

const styles = StyleSheet.create({
  host: { ...StyleSheet.absoluteFillObject, zIndex: 3000 },
  backdrop: { backgroundColor: 'rgba(0,0,0,0.95)' },
  contentSurface: { backgroundColor: '#000000', overflow: 'hidden' },
  pager: { flex: 1 },
  page: { width: SCREEN_W, height: '100%', justifyContent: 'center', alignItems: 'center' },
  image: { width: SCREEN_W, height: '100%' },
  closeBtnWrap: { position: 'absolute', right: 16, zIndex: 20 },
  // Right inset clears the 42 pt close button plus its margin, so a long display name truncates
  // instead of sliding underneath it.
  header: { position: 'absolute', left: 16, right: 70, zIndex: 10 },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', zIndex: 10 },
});

/**
 * Memoized on the payload reference plus primitives. The chat screen re-renders
 * frequently; without this the viewer's pager was being handed new props (and thus
 * re-rendering every mounted image) on each of those renders, which is what made
 * dragging it stutter.
 */
export const ImageViewerModal = memo(
  ImageViewerModalComponent,
  (prev, next) =>
    prev.payload === next.payload &&
    prev.onClose === next.onClose &&
    prev.topInset === next.topInset &&
    prev.proxyWidth === next.proxyWidth &&
    // Chrome nodes are compared by reference, so a caller MUST memoize them — an inline
    // `header={<View/>}` would defeat this comparator and re-render the pager (all three mounted
    // images) on every parent render, which is precisely the bug that made the chat viewer stutter
    // when it was inline JSX. Both profile callers memoize.
    prev.header === next.header &&
    prev.footer === next.footer &&
    prev.bottomInset === next.bottomInset &&
    prev.zoomable === next.zoomable,
);
