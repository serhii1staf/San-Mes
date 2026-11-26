import React from 'react';
import { StyleSheet } from 'react-native';
import Reanimated from 'react-native-reanimated';
import { useBrowserBandHeight } from '../../lib/browserWidget';
import { BAND_LAYOUT_TRANSITION } from '../../lib/browserBandShared';

/**
 * A screen's bottom chrome (the composer, its scrim and panels, a transcript anchored at the bottom),
 * held so it glides with the minimized-session bar instead of jumping when the bar takes or gives
 * back its space.
 *
 * ── WHY ──────────────────────────────────────────────────────────────────────────────────────────
 *
 * The bar shortens every screen above it in one commit (BrowserBottomBand), so whatever is pinned to
 * a screen's bottom moves by the bar's height in one frame. Closing the bar with its × in a chat
 * dropped the composer and every message by about 60 pt at once, and only then did the bar slide
 * away. In Telegram the input panel and the messages glide down with the bar. The tab bar and the
 * search field already glide on a layout transition of their own frame; this does the same for a
 * whole group.
 *
 * ── HOW ──────────────────────────────────────────────────────────────────────────────────────────
 *
 * A layer whose BOTTOM is the screen's bottom and whose TOP is the bar's height above the screen's
 * top, so its height never changes and only its origin does when the bar comes or goes. A Reanimated
 * layout transition animates exactly that origin, on the bar's spring, on the UI thread, starting
 * from the commit itself, so there is no frame with the content already in its new place.
 * Not a transform driven by a shared value: set from JS, that lands a frame before or after the
 * commit that moves the layout, and the content flickers by the bar's height.
 *
 * Children positioned from the layer's bottom behave exactly as if pinned to the screen's bottom.
 * A child that must fill the screen uses `top: bandH` (`useBrowserBandHeight()`), so its own frame is
 * the screen's, as before. `onLayout` inside reports `y` from the layer's top: subtract the same
 * `bandH` to get the screen's coordinate.
 *
 * Only for screens inside the navigator's own area (pushed screens), the same ones that pad by
 * `useBottomChromeInset`.
 *
 * ── `sink`: NOTHING INSIDE MAY CHANGE WITH THE BAR ───────────────────────────────────────────────
 *
 * The transition animates only the layer's own frame; whatever changes inside it in the same commit
 * jumps. The composers used to pad by `useBottomChromeInset()`, which steps from 0 to the safe area
 * when the bar goes, so the field, its reply strip and the scrim hopped up by that much (about 20 pt on
 * an iPhone) and only then glided ("the dimming and the strip with the author jump when I press ×").
 *
 * So the chrome inside pads by its no-bar value, always, and the layer itself sits `sink` lower while
 * the bar is shown, which is where the smaller padding used to put it. The layer keeps its height and
 * only its origin moves, so the transition carries everything. `useBandFollowOffset(sink)` is where
 * the screen's top is inside the layer.
 */
export function BandFollowLayer({ children, sink = 0 }: { children: React.ReactNode; sink?: number }) {
  const bandH = useBrowserBandHeight();
  const s = bandH > 0 ? sink : 0;
  return (
    <Reanimated.View pointerEvents="box-none" layout={BAND_LAYOUT_TRANSITION} style={[styles.layer, { top: s - bandH, bottom: -s }]}>
      {children}
    </Reanimated.View>
  );
}

/**
 * How far below the layer's top the screen's top is, for a layer with this `sink`: the `top` of a child
 * that fills the screen, and what to subtract from a `y` measured inside the layer.
 */
export function useBandFollowOffset(sink = 0): number {
  const bandH = useBrowserBandHeight();
  return bandH > 0 ? bandH - sink : 0;
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', left: 0, right: 0, bottom: 0 },
});
