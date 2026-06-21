import * as Haptics from 'expo-haptics';

// Chat message sound effects.
//
// The (web) reference app synthesised these with the Web Audio API, which does
// not exist in React Native. Instead we ship the exact same "swoosh"/"pop" as
// tiny baked WAV assets (see scripts/gen-message-sounds.mjs) and play them with
// expo-av — which is already in the native build, so this ships over OTA.
//
// Everything is guarded: on a binary without expo-av, or if the asset fails to
// load, we silently fall back to a haptic so the send button still gives
// feedback. We deliberately do NOT touch the global audio mode so the music
// player's background-audio session is never disturbed.

let AudioApi: any = null;
let sendSound: any = null;
let receiveSound: any = null;
let preloadStarted = false;

function getAudio(): any {
  if (AudioApi) return AudioApi;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    AudioApi = require('expo-av').Audio;
  } catch {
    AudioApi = null;
  }
  return AudioApi;
}

async function preload(): Promise<void> {
  if (preloadStarted) return;
  preloadStarted = true;
  const Audio = getAudio();
  if (!Audio) return;
  try {
    const { sound } = await Audio.Sound.createAsync(require('../../assets/sounds/send.wav'), { volume: 1.0 });
    sendSound = sound;
  } catch {}
  try {
    const { sound } = await Audio.Sound.createAsync(require('../../assets/sounds/receive.wav'), { volume: 1.0 });
    receiveSound = sound;
  } catch {}
}

// Best-effort warm on first import so the first send has zero latency.
void preload();

async function replay(sound: any): Promise<void> {
  if (!sound) return;
  try { await sound.replayAsync(); } catch {}
}

/** Play the "swoosh" sent-message sound (with a light haptic as companion). */
export async function playSendSound(): Promise<void> {
  try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
  if (sendSound) { void replay(sendSound); return; }
  await preload();
  void replay(sendSound);
}

/** Play the soft "pop" received-message sound. */
export async function playReceiveSound(): Promise<void> {
  if (receiveSound) { void replay(receiveSound); return; }
  await preload();
  void replay(receiveSound);
}
