import * as Haptics from 'expo-haptics';
import { useSettingsStore } from '../store/settingsStore';

export function triggerHaptic(type: 'light' | 'medium' | 'heavy' | 'selection' = 'light') {
  const { hapticEnabled } = useSettingsStore.getState();
  if (!hapticEnabled) return;

  switch (type) {
    case 'light':
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      break;
    case 'medium':
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      break;
    case 'heavy':
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      break;
    case 'selection':
      Haptics.selectionAsync();
      break;
  }
}
