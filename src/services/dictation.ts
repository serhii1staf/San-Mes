/**
 * Voice dictation for the chat composer: what the user says is recorded and turned into text by
 * Whisper on our Worker (`POST /v1/ai/transcribe`, workers/api/src/routes/ai.ts).
 *
 * ── WHY NOT THE PHONE'S OWN RECOGNISER (Nov 2026) ────────────────────────────────────────────────
 *
 * The first version used it (Apple's and Google's, through expo-speech-recognition), with the words
 * appearing while they were heard. It was rejected for the very thing the feature was asked for: the
 * built-in one "always misunderstands speech and phrases it strangely". Whisper large-v3-turbo hears
 * Russian far better and punctuates.
 *
 * ── THE TEXT ARRIVES PHRASE BY PHRASE, WHILE THE USER SPEAKS (Nov 2026) ─────────────────────────
 *
 * Asked for once it worked: the transcription "can take long", the words should show up while
 * speaking. Whisper takes a finished recording, not a stream, so the recording is cut into phrases:
 * at a pause in speech (`SEGMENT_PAUSE_MS`) the current file is closed and sent, and a new one starts
 * at once, in the silence, so no word is cut. Each phrase's text is added to the field as soon as it
 * comes back, in order, with the text before it as Whisper's context (`prompt`) so the sentence reads
 * on. Stop sends only the last phrase.
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
 * leaves the foreground and when the chat closes. Each phrase is sent once, to our Worker, and deleted
 * from the phone right after; the Worker hands it to Workers AI (zero data retention) and keeps
 * nothing. See docs/privacy.html §3 and §4.
 */
import { AppState, Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

type ExpoAudio = typeof import('expo-audio');
type Recorder = import('expo-audio').AudioRecorder;

/** A recording stops by itself after this long without speech, so a forgotten microphone closes. */
const SILENCE_STOP_MS = 8000;
/** And after this long in any case. */
const MAX_RECORDING_MS = 180_000;
/** How often the input level is read (the glow, the bars, the pauses). */
const LEVEL_INTERVAL_MS = 100;
/** A pause in speech this long ends a phrase, which is sent at once. */
const SEGMENT_PAUSE_MS = 800;
/** A phrase shorter than this waits for the next pause: Whisper needs a little context. */
const SEGMENT_MIN_MS = 2200;
/** And one without a pause is cut here, inside Whisper's 30-second window. */
const SEGMENT_MAX_MS = 24_000;
/** A phrase (or the whole recording) shorter than this is a slip of the finger: nothing is sent. */
const MIN_RECORDING_MS = 700;
/** Above this (dBFS) is speech; at or below `SILENCE_DB` is a pause. */
const SPEECH_DB = -36;
const SILENCE_DB = -44;
/** How much of the text so far goes with each phrase as Whisper's context. */
const PROMPT_CHARS = 240;
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
  /** Recording has stopped; the last phrase is on its way to be turned into text. */
  onTranscribing?: () => void;
  /** The next phrase, as text, in the order it was said. */
  onText: (text: string) => void;
  /**
   * The session is over. `error` is set when a phrase could not be turned into text; `settingsOnly`
   * when the microphone was refused for good (only Settings can grant it now); `nothingHeard` when
   * the user spoke but no words came back.
   */
  onEnd: (info: { cancelled: boolean; error?: DictationError; settingsOnly?: boolean; nothingHeard?: boolean }) => void;
}

export interface DictationSession {
  /** Stop recording; the last phrase is turned into text. */
  stop: () => void;
  /** Stop and throw everything from this session away, including phrases still on their way. */
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

async function startRecorder(a: ExpoAudio): Promise<Recorder> {
  const rec = newRecorder(a);
  try {
    await rec.prepareToRecordAsync();
    rec.record();
  } catch (e) {
    try {
      rec.release();
    } catch {}
    throw e;
  }
  return rec;
}

function errorKindOf(e: string): DictationError {
  if (e === 'offline' || /timeout|network|fetch/i.test(e)) return 'network';
  if (/daily_limit|429/.test(e)) return 'limit';
  return 'other';
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

  let rec: Recorder;
  try {
    await a.setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    rec = await startRecorder(a);
  } catch {
    await restoreAudio(a, musicPaused);
    h.onEnd({ cancelled: false, error: 'other' });
    return null;
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { apiPost } = require('./apiClient') as typeof import('./apiClient');
  // Wakes the model up while the user is still speaking: after a pause the first transcription
  // otherwise waits about 12 s for it to load (see workers/api/src/routes/ai.ts).
  void apiPost(WARM_PATH, {}, { timeoutMs: 10_000 });

  let phase: 'recording' | 'transcribing' | 'done' = 'recording';
  let cancelled = false;
  const startedAt = Date.now();
  let lastSound = startedAt;
  let segStartedAt = startedAt;
  let heardInSegment = false;
  let heardAny = false;
  let cutting: Promise<void> | null = null;
  const abort = new AbortController();

  // The phrases sent so far, in order: their text once it is back (null while on its way).
  const phrases: (string | null)[] = [];
  const inFlight: Promise<void>[] = [];
  let nextToShow = 0;
  let shownText = '';
  let emitted = 0;
  let failure: DictationError | undefined;

  const showReady = () => {
    while (nextToShow < phrases.length && phrases[nextToShow] !== null) {
      const text = phrases[nextToShow] as string;
      nextToShow += 1;
      if (!text || cancelled) continue;
      emitted += 1;
      shownText = shownText ? `${shownText} ${text}` : text;
      h.onText(text);
    }
  };

  const send = (uri: string) => {
    const index = phrases.length;
    phrases.push(null);
    const prompt = shownText.slice(-PROMPT_CHARS);
    const job = (async () => {
      let audio = '';
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { File } = require('expo-file-system') as typeof import('expo-file-system');
        audio = await new File(uri).base64();
      } catch {}
      deleteFile(uri);
      let text = '';
      if (audio && !cancelled) {
        for (let attempt = 0; attempt < 2 && !cancelled; attempt++) {
          const res = await apiPost<{ text?: string }>(
            TRANSCRIBE_PATH,
            { audio, lang, ...(prompt ? { prompt } : null) },
            { timeoutMs: TRANSCRIBE_TIMEOUT_MS, signal: abort.signal },
          );
          if (!res.error) {
            text = typeof res.data?.text === 'string' ? res.data.text.trim() : '';
            break;
          }
          const kind = errorKindOf(String(res.error));
          // One more try for a dropped connection or a busy minute; a day's limit will not pass.
          if (attempt === 0 && kind !== 'limit') {
            await new Promise((r) => setTimeout(r, 1500));
            continue;
          }
          failure = kind;
        }
      } else if (!audio) {
        failure = 'other';
      }
      phrases[index] = text;
      showReady();
    })();
    inFlight.push(job);
  };

  /** Ends the current file; starts the next one unless `last`. Sends it if it had speech in it. */
  const cut = (last: boolean): Promise<void> => {
    const run = async () => {
      const old = rec;
      const began = segStartedAt;
      const heard = heardInSegment;
      let uri: string | null = null;
      try {
        await old.stop();
        uri = old.uri;
      } catch {}
      try {
        old.release();
      } catch {}
      if (!last && phase === 'recording' && !cancelled) {
        try {
          rec = await startRecorder(a);
          segStartedAt = Date.now();
          heardInSegment = false;
        } catch {
          // Could not go on recording: what was said so far is still sent, and the session stops.
          void stop();
        }
      }
      if (uri && heard && !cancelled && Date.now() - began >= MIN_RECORDING_MS) send(uri);
      else deleteFile(uri);
    };
    cutting = run().finally(() => {
      cutting = null;
    });
    return cutting;
  };

  const meter = setInterval(() => {
    if (phase !== 'recording' || cutting) return;
    let db = -160;
    try {
      db = rec.getStatus().metering ?? -160;
    } catch {}
    const now = Date.now();
    if (db > SPEECH_DB) {
      heardInSegment = true;
      heardAny = true;
    }
    if (db > SILENCE_DB) lastSound = now;
    // -50 dB and below is silence, -10 dB is a raised voice.
    h.onLevel?.(Math.max(0, Math.min(1, (db + 50) / 40)));
    if (now - lastSound > SILENCE_STOP_MS || now - startedAt > MAX_RECORDING_MS) {
      void stop();
      return;
    }
    const segFor = now - segStartedAt;
    if ((heardInSegment && segFor >= SEGMENT_MIN_MS && now - lastSound >= SEGMENT_PAUSE_MS) || segFor >= SEGMENT_MAX_MS) {
      void cut(false);
    }
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

  const stop = async () => {
    if (phase !== 'recording') return;
    phase = 'transcribing';
    clearInterval(meter);
    if (cutting) await cutting;
    await cut(true);
    await restoreAudio(a, musicPaused);
    if (cancelled) return;
    if (inFlight.length > 0 && nextToShow < phrases.length) h.onTranscribing?.();
    await Promise.all(inFlight);
    if (cancelled) return;
    finish({ cancelled: false, error: failure, nothingHeard: !failure && heardAny && emitted === 0 });
  };

  const cancel = () => {
    if (phase === 'done') return;
    cancelled = true;
    abort.abort();
    if (phase === 'recording') {
      phase = 'transcribing';
      clearInterval(meter);
      void (async () => {
        if (cutting) await cutting;
        await cut(true);
        await restoreAudio(a, musicPaused);
      })();
    }
    // At once: nothing from this session may arrive after the field has been put back.
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
