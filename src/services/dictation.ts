/**
 * Voice dictation for the chat composer: what the user says is recorded while they speak and turned
 * into text by Whisper on our Worker (`POST /v1/ai/transcribe`, workers/api/src/routes/ai.ts).
 *
 * ── WHY NOT THE PHONE'S OWN RECOGNISER (Nov 2026) ────────────────────────────────────────────────
 *
 * The first version used it (Apple's and Google's, through expo-speech-recognition), with the words
 * appearing while they were heard. It was rejected for the very thing the feature was asked for: the
 * built-in one "always misunderstands speech and phrases it strangely". Whisper large-v3-turbo hears
 * Russian far better and punctuates. The text arrives a moment after the user stops, as in ChatGPT's
 * dictation.
 *
 * ── ONLY ON BINARIES THAT MAY RECORD ─────────────────────────────────────────────────────────────
 *
 * Recording needs NSMicrophoneUsageDescription on iOS (without it the first request crashes the app)
 * and RECORD_AUDIO on Android, and updates reach older binaries over the air (the runtime version is
 * the app version). So the mic is shown only on a binary whose build number is at least the first one
 * that declares them; see "THE TEST WAS WRONG" below.
 *
 * ── PRIVACY ──────────────────────────────────────────────────────────────────────────────────────
 *
 * Before the first recording the user is told where it goes and agrees (`hasDictationConsent`). The
 * microphone is on only while the composer shows it (the glow and the moving bars). A recording ends
 * on stop, on the bin, after `SILENCE_STOP_MS` without speech, after `MAX_RECORDING_MS`, when the app
 * leaves the foreground and when the chat closes. It is sent once, to our Worker, and deleted from the
 * phone right after; the Worker hands it to Workers AI (zero data retention) and keeps nothing.
 * See docs/privacy.html §3 and §4.
 */
import { AppState, Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

type ExpoAudio = typeof import('expo-audio');
type Recorder = import('expo-audio').AudioRecorder;

/** A recording stops by itself after this long without speech, so a forgotten microphone closes. */
const SILENCE_STOP_MS = 8000;
/** And after this long in any case. */
const MAX_RECORDING_MS = 180_000;
/** How often the input level is read (the glow and the stop button follow it). */
const LEVEL_INTERVAL_MS = 100;
/** Shorter than this is a slip of the finger: nothing is sent. */
const MIN_RECORDING_MS = 700;
/** Below this level (dBFS) counts as silence for `SILENCE_STOP_MS`. */
const SILENCE_DB = -42;
const TRANSCRIBE_PATH = '/v1/ai/transcribe';
const WARM_PATH = '/v1/ai/transcribe/warm';
const TRANSCRIBE_TIMEOUT_MS = 45_000;
const CONSENT_KEY = 'dictation_consent_v1';

// ── THE TEST WAS WRONG: EXPO-APPLICATION WAS ALREADY IN EVERY BINARY (Nov 2026) ──────────────────
//
// The first version of this file took the presence of expo-application as the sign of a binary that
// may record, on the belief that it came with build 108. It did not: expo-notifications depends on it,
// so autolinking had put it into every earlier build too. On those iPhones the mic showed, and the
// first tap would have asked for the microphone with no NSMicrophoneUsageDescription in Info.plist,
// which iOS answers by terminating the app. Now the test is the binary's own build number
// (CFBundleVersion / versionCode): the microphone string first shipped in iOS build 108. No Android
// build has been made with RECORD_AUDIO yet (every earlier one removed it, see app.json), so Android
// shows no mic until `ANDROID_FIRST_MIC_BUILD` is set to that build's versionCode.
const IOS_FIRST_MIC_BUILD = 108;
const ANDROID_FIRST_MIC_BUILD = Number.POSITIVE_INFINITY;

let availableCache: boolean | undefined;
/** Whether this binary may record (see above). Cached. */
export function dictationAvailable(): boolean {
  if (availableCache !== undefined) return availableCache;
  availableCache = false;
  try {
    if (!requireOptionalNativeModule('ExpoApplication')) return false;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const build = Number((require('expo-application') as typeof import('expo-application')).nativeBuildVersion);
    const first = Platform.OS === 'ios' ? IOS_FIRST_MIC_BUILD : Platform.OS === 'android' ? ANDROID_FIRST_MIC_BUILD : Number.POSITIVE_INFINITY;
    availableCache = Number.isFinite(build) && build >= first;
  } catch {
    availableCache = false;
  }
  return availableCache;
}

/** The account has been told where a recording goes and agreed. Stored per account. */
export function hasDictationConsent(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('./kvStore') as typeof import('./kvStore')).kvGetStringSync(CONSENT_KEY) === '1';
  } catch {
    return false;
  }
}

export function grantDictationConsent(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('./kvStore') as typeof import('./kvStore')).kvSetString(CONSENT_KEY, '1');
  } catch {}
}

export type DictationError = 'permission' | 'network' | 'limit' | 'other';

export interface DictationHandlers {
  /** The input level, 0..1, about every `LEVEL_INTERVAL_MS` while recording. */
  onLevel?: (level: number) => void;
  /** Recording has stopped and the recording is on its way to be turned into text. */
  onTranscribing?: () => void;
  /** What was said, as text (empty when nothing could be made out). */
  onText: (text: string) => void;
  /**
   * The session is over. `error` is set for a failure worth telling the user about; `settingsOnly`
   * when the microphone was refused for good (only Settings can grant it now); `nothingHeard` when a
   * real recording came back without words.
   */
  onEnd: (info: { cancelled: boolean; error?: DictationError; settingsOnly?: boolean; nothingHeard?: boolean }) => void;
}

export interface DictationSession {
  /** Stop recording and turn what was said into text. */
  stop: () => void;
  /** Stop and throw the recording away (also while it is being turned into text). */
  cancel: () => void;
}

function audioLib(): ExpoAudio | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-audio') as ExpoAudio;
  } catch {
    return null;
  }
}

/** Speech-sized: mono AAC at 16 kHz and 32 kbit/s, about 240 KB a minute. */
function newRecorder(a: ExpoAudio): Recorder {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const AudioModule = (require('expo-audio/build/AudioModule') as { default: { AudioRecorder: new (o: unknown) => Recorder } }).default;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createRecordingOptions } = require('expo-audio/build/utils/options') as { createRecordingOptions: (o: unknown) => unknown };
  return new AudioModule.AudioRecorder(
    createRecordingOptions({
      extension: '.m4a',
      sampleRate: 16000,
      numberOfChannels: 1,
      bitRate: 32000,
      isMeteringEnabled: true,
      android: { extension: '.m4a', outputFormat: 'mpeg4', audioEncoder: 'aac' },
      ios: { outputFormat: a.IOSOutputFormat.MPEG4AAC, audioQuality: a.AudioQuality.MEDIUM },
      web: { mimeType: 'audio/webm', bitsPerSecond: 32000 },
    }),
  );
}

let current: { cancel: () => void } | null = null;

/**
 * Asks for the microphone (the system prompts once), then records. Resolves to the running session,
 * or null when it could not start (`onEnd` has been called then).
 */
export async function startDictation(lang: string, h: DictationHandlers): Promise<DictationSession | null> {
  const a = audioLib();
  if (!a || !dictationAvailable()) {
    h.onEnd({ cancelled: false, error: 'other' });
    return null;
  }
  current?.cancel();
  current = null;

  try {
    const perm = await a.requestRecordingPermissionsAsync();
    if (!perm.granted) {
      h.onEnd({ cancelled: false, error: 'permission', settingsOnly: perm.canAskAgain === false });
      return null;
    }
  } catch {
    h.onEnd({ cancelled: false, error: 'other' });
    return null;
  }

  // Music would be recorded with the voice: it pauses, and plays on once the recording is done.
  let musicPaused = false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const music = (require('../store/musicStore') as typeof import('../store/musicStore')).useMusicStore.getState();
    if (music.isPlaying) {
      await music.toggle();
      musicPaused = true;
    }
  } catch {}

  let recorder: Recorder | null = null;
  try {
    await a.setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    recorder = newRecorder(a);
    await recorder.prepareToRecordAsync();
    recorder.record();
  } catch {
    try {
      recorder?.release();
    } catch {}
    await restoreAudio(a, musicPaused);
    h.onEnd({ cancelled: false, error: 'other' });
    return null;
  }
  const rec = recorder;
  // Wakes the model up while the user is still speaking: after a pause the first transcription
  // otherwise waits about 12 s for it to load (see workers/api/src/routes/ai.ts).
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    void (require('./apiClient') as typeof import('./apiClient')).apiPost(WARM_PATH, {}, { timeoutMs: 10_000 });
  } catch {}

  let phase: 'recording' | 'transcribing' | 'done' = 'recording';
  let cancelled = false;
  const startedAt = Date.now();
  let lastSound = startedAt;
  const abort = new AbortController();

  const meter = setInterval(() => {
    if (phase !== 'recording') return;
    let db = -160;
    try {
      db = rec.getStatus().metering ?? -160;
    } catch {}
    const now = Date.now();
    if (db > SILENCE_DB) lastSound = now;
    // -50 dB and below is silence, -10 dB is a raised voice.
    h.onLevel?.(Math.max(0, Math.min(1, (db + 50) / 40)));
    if (now - lastSound > SILENCE_STOP_MS || now - startedAt > MAX_RECORDING_MS) void stop();
  }, LEVEL_INTERVAL_MS);
  const appState = AppState.addEventListener('change', (s) => {
    if (s !== 'active') void stop();
  });

  const finish = (info: Parameters<DictationHandlers['onEnd']>[0]) => {
    if (phase === 'done') return;
    phase = 'done';
    clearInterval(meter);
    appState.remove();
    if (current === handle) current = null;
    h.onEnd(info);
  };

  /** Ends the recording and returns its file, or null. Leaves the audio as it was before. */
  const endRecording = async (): Promise<string | null> => {
    clearInterval(meter);
    let uri: string | null = null;
    try {
      await rec.stop();
      uri = rec.uri;
    } catch {}
    try {
      rec.release();
    } catch {}
    await restoreAudio(a, musicPaused);
    return uri;
  };

  const stop = async () => {
    if (phase !== 'recording') return;
    phase = 'transcribing';
    const heardFor = Date.now() - startedAt;
    const uri = await endRecording();
    if (cancelled) return;
    if (!uri || heardFor < MIN_RECORDING_MS) {
      deleteFile(uri);
      finish({ cancelled: false });
      return;
    }
    h.onTranscribing?.();
    let audio = '';
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { File } = require('expo-file-system') as typeof import('expo-file-system');
      audio = await new File(uri).base64();
    } catch {}
    deleteFile(uri);
    if (cancelled) return;
    if (!audio) {
      finish({ cancelled: false, error: 'other' });
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { apiPost } = require('./apiClient') as typeof import('./apiClient');
    const res = await apiPost<{ text?: string }>(TRANSCRIBE_PATH, { audio, lang }, { timeoutMs: TRANSCRIBE_TIMEOUT_MS, signal: abort.signal });
    if (cancelled) return;
    if (res.error) {
      const e = String(res.error);
      finish({
        cancelled: false,
        error: e === 'offline' || /timeout|network|fetch/i.test(e) ? 'network' : /daily_limit|429/.test(e) ? 'limit' : 'other',
      });
      return;
    }
    const text = typeof res.data?.text === 'string' ? res.data.text.trim() : '';
    if (text) h.onText(text);
    finish({ cancelled: false, nothingHeard: !text });
  };

  const cancel = () => {
    if (phase === 'done') return;
    cancelled = true;
    abort.abort();
    if (phase === 'recording') {
      phase = 'transcribing';
      void endRecording().then(deleteFile);
    }
    // At once: the words go now, and nothing from this session may arrive after that.
    finish({ cancelled: true });
  };
  const handle = { cancel };
  current = handle;
  return { stop: () => void stop(), cancel };
}

function deleteFile(uri: string | null) {
  if (!uri) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { File } = require('expo-file-system') as typeof import('expo-file-system');
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {}
}

/** Back to playback: the record category off, the player's own mode, and the music if it was paused. */
async function restoreAudio(a: ExpoAudio, resumeMusic: boolean) {
  try {
    await a.setAudioModeAsync({ allowsRecording: false });
  } catch {}
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require('../store/musicStore') as typeof import('../store/musicStore');
    await m.reassertAudioMode();
    if (resumeMusic && !m.useMusicStore.getState().isPlaying) await m.useMusicStore.getState().toggle();
  } catch {}
}
