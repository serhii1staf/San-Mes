import * as Haptics from 'expo-haptics';

/**
 * Play send feedback — strong haptic that feels like a "send" confirmation
 * Combines impact + notification for a distinct "click" feeling
 */
export async function playSendSound() {
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch {}
}
