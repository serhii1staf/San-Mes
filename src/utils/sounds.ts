import * as Haptics from 'expo-haptics';

/**
 * Play send feedback — notification haptic as sound substitute
 * Real audio sound requires a native rebuild with expo-av
 */
export async function playSendSound() {
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch {}
}
