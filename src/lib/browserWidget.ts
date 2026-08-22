import { useSettingsStore } from '../store/settingsStore';

/**
 * Master switch for the BOTTOM minimised-browser widget.
 *
 * Currently OFF, deliberately and temporarily. The bottom variant is the one that has
 * to occupy real layout space and push the tab bar / chat composer upward, and that
 * coupling is what produced the recent breakages: a negative margin that clipped the
 * navigation, and a `LayoutAnimation` that animated unrelated rows because
 * `configureNext` applies to the whole next layout commit rather than to one component.
 *
 * The top variant has none of that risk — it is an absolutely-positioned overlay, so
 * showing or hiding it changes no other view's frame. Running only the top widget takes
 * the layout-coupled path out of the app while the remaining behavioural bugs are dealt
 * with.
 *
 * Turning it back on is this one flag. What must be fixed BEFORE it goes back on:
 *
 *   The band has to stop reserving layout height. Instead it should publish its height
 *   as a shared value, and each affected surface (tab bar, chat composer) applies its
 *   OWN transform from it. Then the widget appearing never triggers a layout pass, the
 *   content eases in step with the bar for free, and there is nothing to overlap.
 */
export const BOTTOM_BAND_ENABLED = false;

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
