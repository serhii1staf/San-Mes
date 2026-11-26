import { LinearTransition, makeMutable } from 'react-native-reanimated';
import { BAND_SPRING } from './browserWidget';

/**
 * The minimized-session bar's height on the UI thread, for keyboard maths (0 without the bar).
 *
 * The keyboard is measured from the bottom of the WINDOW. A screen shortened by the bar ends that
 * much higher, so the keyboard covers the bar before it reaches the screen's composer: every
 * keyboard-following transform subtracts this. Written by BrowserBottomBand when it shows or goes.
 *
 * Separate from src/lib/browserWidget.ts so the screens and overlays that only need the React-side
 * numbers do not pull in Reanimated.
 */
export const browserBandHeightSV = makeMutable(0);
let jsMirror = 0;

export function setBrowserBandHeightShared(height: number): void {
  jsMirror = height;
  try {
    browserBandHeightSV.value = height;
  } catch {
    // Test environments without a real Reanimated runtime.
  }
}

/** The same number on the JS thread, for code that runs once (a keyboard end, a menu opening). */
export function getBrowserBandHeightNow(): number {
  return jsMirror;
}

/**
 * For bottom chrome whose place on screen changes when the bar takes or gives back its space (the
 * tab bar, the search field). A layout transition animates the view's own frame on the UI thread,
 * only for that view, so the tab bar glides up or down with the bar instead of jumping. It is not
 * `LayoutAnimation`, which applies to everything in the next commit. On the bar's spring
 * (`BAND_SPRING`).
 */
export const BAND_LAYOUT_TRANSITION = LinearTransition.springify()
  .damping(BAND_SPRING.damping)
  .stiffness(BAND_SPRING.stiffness)
  .mass(BAND_SPRING.mass);
