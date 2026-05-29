import { Audio } from 'expo-av';

let sendSound: Audio.Sound | null = null;

/**
 * Play a short send sound (beep)
 */
export async function playSendSound() {
  try {
    await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
    if (!sendSound) {
      const { sound } = await Audio.Sound.createAsync(
        require('../../assets/send.wav'),
        { shouldPlay: false, volume: 0.5 }
      );
      sendSound = sound;
    }
    await sendSound.setPositionAsync(0);
    await sendSound.playAsync();
  } catch {
    // Silently fail
  }
}
