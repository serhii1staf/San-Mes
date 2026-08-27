import * as Haptics from 'expo-haptics';

// Chat message sound effects.
//
// The (web) reference app synthesised these with the Web Audio API, which does
// not exist in React Native. Instead we ship the exact same "swoosh"/"pop" as
// tiny baked WAV assets (see scripts/gen-message-sounds.mjs) and play them with
// expo-audio.
//
// NOTE ON OTA: this used to say "expo-av is already in the native build, so this ships over OTA".
// That is no longer true — `expo-audio` is a DIFFERENT native module, so the first build carrying this
// file must be a native build. The lazy `require` plus the guards below mean that until that build
// lands the app degrades to haptic-only feedback rather than crashing, which is why the guards are kept
// rather than simplified now that the import is a hard dependency elsewhere.
//
// Everything is guarded: on a binary without expo-audio, or if the asset fails to
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
    AudioApi = require('expo-audio');
  } catch {
    AudioApi = null;
  }
  return AudioApi;
}

async function preload(): Promise<void> {
  if (preloadStarted) return;
  preloadStarted = true;
  const Audio = getAudio();
  if (!Audio?.createAudioPlayer) return;
  // ── `keepAudioSessionActive` IS THE WHOLE POINT HERE ───────────────────────
  //
  // These are one-shot UI blips that must never disturb the music player's session. expo-audio
  // deactivates the audio session when a player finishes, which for a 200 ms send sound would
  // interrupt whatever the music store is playing — the exact thing the note at the top of this file
  // promises not to do. `keepAudioSessionActive` suppresses that deactivation, and the docs describe
  // it as being for precisely this case: "sound effects that should not interfere with ongoing video
  // playback or other audio".
  //
  // These players are deliberately never `remove()`d: there are exactly two of them, they live for the
  // lifetime of the app, and they are re-triggered rather than recreated per send.
  try {
    const p = Audio.createAudioPlayer(require('../../assets/sounds/send.wav'), { keepAudioSessionActive: true });
    p.volume = 1.0;
    sendSound = p;
  } catch {}
  try {
    const p = Audio.createAudioPlayer(require('../../assets/sounds/receive.wav'), { keepAudioSessionActive: true });
    p.volume = 1.0;
    receiveSound = p;
  } catch {}
}

// Best-effort warm on first import so the first send has zero latency.
void preload();

async function replay(sound: any): Promise<void> {
  if (!sound) return;
  // expo-av had `replayAsync()`; expo-audio has no single-call equivalent, and the documented
  // replacement is exactly this pair (see the "Replay sound" example in the expo-audio docs). Both
  // calls are synchronous — the function stays async because every caller already awaits or voids it.
  try { sound.seekTo(0); sound.play(); } catch {}
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
