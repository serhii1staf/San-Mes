import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

// Feature: seasonal-profile-themes
//
// `useReducedMotion` reflects the OS "reduce motion" accessibility preference so
// the Seasonal Profile Themes feature can suppress ambient animations and render
// a static background while the setting is on (Req 7.2).
//
// It reads the current value once on mount via
// `AccessibilityInfo.isReduceMotionEnabled()` and subscribes to the
// `'reduceMotionChanged'` event. When the user toggles reduce-motion at runtime
// the hook updates its returned boolean (driving a re-render of any consumer)
// WITHOUT remounting the screen — so an active profile suppresses its animation
// within ~500 ms of the toggle (Req 7.3). The OS fires the change event almost
// immediately; we simply mirror it into React state.

/**
 * Returns whether the OS reduce-motion accessibility setting is currently
 * enabled. Updates live (no remount) when the setting changes.
 */
export function useReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    let mounted = true;

    // Initial read — `isReduceMotionEnabled` resolves a Promise<boolean>.
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) setReducedMotion(enabled);
      })
      .catch(() => {
        // Defensive: if the query fails, assume motion is allowed (no
        // suppression) so themes still animate on platforms that misreport.
        if (mounted) setReducedMotion(false);
      });

    // Live updates — the subscription fires whenever the user toggles the OS
    // setting, so consumers re-render and re-evaluate the animation gate within
    // ~500 ms without the screen remounting (Req 7.3).
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (enabled: boolean) => {
        if (mounted) setReducedMotion(enabled);
      },
    );

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return reducedMotion;
}
