import { usePowerMode } from './usePowerMode';
import { useReducedMotion } from './useReducedMotion';

/**
 * Whether decorative animated media (a GIF chat wallpaper, a GIF profile banner) may play at all.
 *
 * No in Low Power Mode, where the OS halves the frame budget and every decoded GIF frame competes
 * with scrolling and the keyboard; and no with Reduce Motion on, which asks for exactly this. The
 * media still shows, on its first frame. Where Low Power Mode cannot be read (`unknown`, a binary
 * without expo-battery) this behaves as before.
 *
 * Screen-specific pauses (scrolling, the keyboard moving, the screen not focused) are the caller's.
 */
export function useAmbientMotionAllowed(): boolean {
  const powerMode = usePowerMode();
  const reducedMotion = useReducedMotion();
  return powerMode !== 'low_power' && !reducedMotion;
}
