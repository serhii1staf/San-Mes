import { useMemo } from 'react';
import { useWeakDevice } from '../utils/deviceCapability';
import { renderBudget, type RenderBudget } from '../utils/renderBudget';
import { usePowerMode } from './usePowerMode';

/**
 * Live frame budget for the current device and power state.
 *
 * Re-resolves when Low Power Mode is toggled mid-session, so a user switching it on
 * while scrolling gets the lighter path immediately rather than on next launch.
 *
 * `isWeakDevice()` is constant for the session, so the only moving input is the
 * power mode.
 */
export function useRenderBudget(): RenderBudget {
  const isWeak = useWeakDevice();
  const powerMode = usePowerMode();
  return useMemo(() => renderBudget({ isWeak, powerMode }), [isWeak, powerMode]);
}
