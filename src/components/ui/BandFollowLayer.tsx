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
 */
export function BandFollowLayer({ children }: { children: React.ReactNode }) {
  const bandH = useBrowserBandHeight();
  return (
    <Reanimated.View pointerEvents="box-none" layout={BAND_LAYOUT_TRANSITION} style={[styles.layer, { top: -bandH }]}>
      {children}
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', left: 0, right: 0, bottom: 0 },
});
