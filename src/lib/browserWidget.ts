import { useContext } from 'react';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { useSettingsStore } from '../store/settingsStore';
import { useBrowserStore } from '../store/browserStore';

/**
 * Master switch for the BOTTOM minimised-session bar (BrowserBottomBand).
 *
 * ── BACK ON, AS TELEGRAM'S MINIMIZED APP BAR (Nov 2026) ─────────────────────────────────────────
 *
 * Asked: the widget for a minimized mini app or site should be at the bottom, like Telegram's today
 * ("один в один"). It was parked in August because the band reserving layout height broke things:
 * a negative margin clipped the navigation, a global `LayoutAnimation` animated unrelated rows, and
 * the content dropped in one frame after the band had slid away. Those are gone (see
 * BrowserBottomBand): the band is in the layout only while it is shown, the screens' own bottom
 * chrome knows its height (the helpers below), and when it goes it leaves the layout at once and
 * slides away over the content instead of leaving a gap behind.
 *
 * Telegram does the same: its minimized container shrinks the app above it
 * (MinimizedContainer.collapsedHeight), so the tab bar and the input panel sit on the bar.
 */
export const BOTTOM_BAND_ENABLED = true;

/** The bar's own row: Telegram's `minimizedNavigationHeight`. */
export const BAND_CONTENT_HEIGHT = 56;
/** The black gap between the app and the bar (Telegram's `minimizedTopMargin`). */
export const BAND_TOP_GAP = 3;
/** Below the row, above the safe area (Telegram adds 3 pt there too). */
const BAND_BOTTOM_EXTRA = 3;

/**
 * The bar's motion, shared with everything that moves with it (the tab bar, the search field, the
 * music pill), so they land together and keep their gaps. A spring that settles in about 0.4 s
 * without overshooting, like Telegram's (`.animated(duration: 0.4, curve: .spring)` in
 * MinimizedContainer). Plain numbers: Reanimated's `withSpring` and RN `Animated.spring` both take
 * damping / stiffness / mass.
 */
export const BAND_SPRING = { damping: 32, stiffness: 260, mass: 1 } as const;

/**
 * How much of the bottom of the window the bar takes, gap and safe area included. The safe area is
 * the bar's, not the screen's: the home indicator (on Android the navigation bar) is under the bar.
 */
export function browserBandHeight(insetsBottom: number): number {
  return BAND_TOP_GAP + BAND_CONTENT_HEIGHT + BAND_BOTTOM_EXTRA + Math.max(0, insetsBottom);
}

/**
 * The widget position actually in effect, as opposed to the one stored in settings.
 *
 * The user's stored preference is preserved untouched — it is only clamped on read, so
 * flipping `BOTTOM_BAND_ENABLED` back to `true` restores whatever each user had chosen
 * without a migration or a reset.
 */
export function useEffectiveBrowserWidgetPosition(): 'top' | 'bottom' {
  const stored = useSettingsStore((s) => s.browserWidgetPosition);
  return BOTTOM_BAND_ENABLED ? stored : 'top';
}

/**
 * Whether the bottom bar is in the layout: a session is minimized and the bar is the chosen widget.
 *
 * The bar and every screen that reads this follow the same store, so they change in the same
 * commit: the screens above never see the bar's space and their own padding disagree.
 */
export function useBrowserBandVisible(): boolean {
  const position = useEffectiveBrowserWidgetPosition();
  const present = useBrowserStore((s) => !!s.minimizedUrl);
  return present && position === 'bottom';
}

/**
 * The bottom safe-area inset, without throwing where there is no SafeAreaProvider (root overlays
 * rendered on their own in tests). The app always has one.
 */
function useInsetsBottom(): number {
  return useContext(SafeAreaInsetsContext)?.bottom ?? 0;
}

/**
 * The height the bar takes from the bottom of the window now, 0 without it.
 *
 * What it is for: overlays drawn at the root (the toast, the music pill) sit above the bar, not above
 * the window's edge. Keyboard maths on the UI thread uses `browserBandHeightSV` instead
 * (src/lib/browserBandShared.ts).
 */
export function useBrowserBandHeight(): number {
  const bottom = useInsetsBottom();
  return useBrowserBandVisible() ? browserBandHeight(bottom) : 0;
}

/**
 * The bottom safe-area inset a screen's own bottom chrome (composer, tab bar, field) should pad by.
 *
 * With the bar showing the home indicator is under the bar, so the screen pads by nothing for it,
 * and its composer sits on the bar the way Telegram's input panel sits on its minimized app bar.
 *
 * Only for screens inside the navigator's own area (pushed screens and tabs). On iOS a screen
 * presented as a native modal covers the whole window, bar included, and keeps the plain inset.
 */
export function useBottomChromeInset(): number {
  const bottom = useInsetsBottom();
  return useBrowserBandVisible() ? 0 : bottom;
}
