/**
 * Voice dictation for the chat composer: the phone's own speech recognition (Apple's Speech framework
 * on iOS, the system recognition service on Android) through expo-speech-recognition. The words
 * appear in the message field as they are recognised; nothing is recorded or stored by the app.
 *
 * ── AN OPTIONAL NATIVE MODULE ────────────────────────────────────────────────────────────────────
 *
 * The module is only in binaries built after it was added (Nov 2026). Updates reach older binaries
 * over the air (the runtime version is the app version), so it is looked up, never imported: without
 * it `dictationAvailable()` is false and the composer keeps its send button as before. Do not turn
 * the lookup into a static import; that would crash every older binary at launch.
 *
 * ── PRIVACY ───────────────────────────────────────────────────────────────────────────────────────
 *
 * The microphone is open only while a session runs, and the composer shows it (the field glows and
 * the stop button moves with the voice). A session ends when it is stopped, cancelled, after
 * `SILENCE_STOP_MS` without speech, after `MAX_SESSION_MS`, and when the app leaves the foreground.
 * The audio is not persisted (`recordingOptions` is left off). See docs/privacy.html §3.
 */
import { AppState, Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

type SpeechLib = typeof import('expo-speech-recognition');
type SpeechModule = SpeechLib['ExpoSpeechRecognitionModule'];
type ResultEvent = import('expo-speech-recognition').ExpoSpeechRecognitionResultEvent;
type ErrorEvent = import('expo-speech-recognition').ExpoSpeechRecognitionErrorEvent;

/** A session stops by itself after this long without speech, so a forgotten microphone closes. */
const SILENCE_STOP_MS = 10_000;
/** And after this long in any case. */
const MAX_SESSION_MS = 180_000;
/** How often the input level is reported (the glow and the stop button follow it). */
const LEVEL_INTERVAL_MS = 120;
/** Waited for the module's `end` after `stop()` or an error, before the session is closed anyway. */
const END_GRACE_MS = 2500;

let speechMod: SpeechModule | null | undefined;
function speech(): SpeechModule | null {
  if (speechMod !== undefined) return speechMod;
  speechMod = null;
  try {
    if (requireOptionalNativeModule('ExpoSpeechRecognition')) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      speechMod = (require('expo-speech-recognition') as SpeechLib).ExpoSpeechRecognitionModule;
    }
  } catch {
    speechMod = null;
  }
  return speechMod;
}

let availableCache: boolean | undefined;
/** Whether this binary has the module and the device has a recognition service. Cached. */
export function dictationAvailable(): boolean {
  if (availableCache !== undefined) return availableCache;
  const m = speech();
  try {
    availableCache = !!m && m.isRecognitionAvailable();
  } catch {
    availableCache = false;
  }
  return availableCache;
}

const LANG_TAGS: Record<string, string> = {
  ru: 'ru-RU', en: 'en-US', uk: 'uk-UA', be: 'be-BY', kk: 'kk-KZ', de: 'de-DE', fr: 'fr-FR',
  es: 'es-ES', it: 'it-IT', pt: 'pt-BR', pl: 'pl-PL', tr: 'tr-TR',
};
/** The recogniser's language tag for an app locale ('ru' → 'ru-RU'). */
export function dictationLang(locale: string | undefined): string {
  if (!locale) return 'ru-RU';
  if (locale.includes('-')) return locale;
  return LANG_TAGS[locale] ?? 'en-US';
}

export type DictationError = 'permission' | 'unavailable' | 'language' | 'network' | 'busy' | 'other';

export interface DictationHandlers {
  /** What was recognised in this session so far: the settled part and the part still being heard. */
  onText: (settled: string, pending: string) => void;
  /** The input level, 0..1, about every `LEVEL_INTERVAL_MS` while listening. */
  onLevel?: (level: number) => void;
  /**
   * The session is over. `error` is set for a failure worth telling the user about; `settingsOnly`
   * when permission was refused for good (only Settings can grant it now).
   */
  onEnd: (info: { cancelled: boolean; error?: DictationError; settingsOnly?: boolean }) => void;
}

export interface DictationSession {
  /** Stop listening and keep what was recognised. */
  stop: () => void;
  /** Stop listening and throw this session's words away. */
  cancel: () => void;
}

/** Joins two runs of recognised words with one space. */
export function joinWords(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  return `${a} ${b}`;
}

/**
 * A recogniser that started over after a pause (iOS does this in long sessions) hands a short new
 * transcript that is not a continuation of the last one: what it had heard must be kept. A revision of
 * the same words (punctuation, a corrected word) stays about as long, so it is not mistaken for one.
 */
function looksLikeRestart(prev: string, next: string): boolean {
  if (next.length >= prev.length * 0.6) return false;
  const head = (s: string) => s.slice(0, 6).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  return head(next) !== head(prev);
}

function errorKind(code: string | undefined): DictationError | null {
  switch (code) {
    case 'no-speech':
    case 'speech-timeout':
    case 'aborted':
      return null;
    case 'not-allowed':
      return 'permission';
    case 'service-not-allowed':
      return 'unavailable';
    case 'language-not-supported':
      return 'language';
    case 'network':
      return 'network';
    case 'busy':
      return 'busy';
    default:
      return 'other';
  }
}

let current: { abort: () => void } | null = null;

/**
 * Asks for the microphone and speech recognition (the system prompts once), then listens in `lang`.
 * Resolves to the running session, or null when it could not start (`onEnd` has been called then).
 */
export async function startDictation(lang: string, h: DictationHandlers): Promise<DictationSession | null> {
  const m = speech();
  if (!m) {
    h.onEnd({ cancelled: false, error: 'unavailable' });
    return null;
  }
  current?.abort();
  current = null;

  try {
    const perm = await m.requestPermissionsAsync();
    if (!perm.granted) {
      h.onEnd({ cancelled: false, error: 'permission', settingsOnly: perm.canAskAgain === false });
      return null;
    }
  } catch {
    h.onEnd({ cancelled: false, error: 'other' });
    return null;
  }

  let settled = '';
  let pending = '';
  let cancelled = false;
  let error: DictationError | undefined;
  let closed = false;
  let lastActivity = Date.now();
  const startedAt = lastActivity;
  const subs: { remove: () => void }[] = [];
  let watchdog: ReturnType<typeof setInterval> | null = null;
  let grace: ReturnType<typeof setTimeout> | null = null;

  const close = () => {
    if (closed) return;
    closed = true;
    if (watchdog) clearInterval(watchdog);
    if (grace) clearTimeout(grace);
    subs.forEach((s) => {
      try {
        s.remove();
      } catch {}
    });
    if (current === handle) current = null;
    // iOS: the module leaves the audio session in its record category; give the player its own back.
    if (Platform.OS === 'ios') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        void (require('../store/musicStore') as typeof import('../store/musicStore')).reassertAudioMode();
      } catch {}
    }
    h.onEnd({ cancelled, error });
  };
  const closeSoon = () => {
    if (closed || grace) return;
    grace = setTimeout(close, END_GRACE_MS);
  };
  const stop = () => {
    if (closed) return;
    try {
      m.stop();
    } catch {
      close();
      return;
    }
    closeSoon();
  };
  const cancel = () => {
    if (closed) return;
    cancelled = true;
    try {
      m.abort();
    } catch {}
    // At once: the words go now, and nothing from this session may arrive after the field is restored.
    close();
  };
  const handle = { abort: cancel };

  subs.push(m.addListener('result', (e: ResultEvent) => {
    if (closed || cancelled) return;
    const text = (e.results?.[0]?.transcript ?? '').trim();
    lastActivity = Date.now();
    if (e.isFinal) {
      settled = joinWords(settled, text);
      pending = '';
    } else {
      if (pending && text && looksLikeRestart(pending, text)) settled = joinWords(settled, pending);
      pending = text;
    }
    h.onText(settled, pending);
  }));
  subs.push(m.addListener('volumechange', (e: { value: number }) => {
    if (closed) return;
    // -2..10; below 0 is silence.
    const level = Math.max(0, Math.min(1, e.value / 8));
    if (level > 0.15) lastActivity = Date.now();
    h.onLevel?.(level);
  }));
  subs.push(m.addListener('error', (e: ErrorEvent) => {
    if (closed) return;
    const kind = errorKind(e?.error);
    if (kind && !cancelled) error = kind;
    closeSoon();
  }));
  subs.push(m.addListener('end', () => {
    // What was still being heard when it ended counts as said.
    if (!closed && !cancelled && pending) {
      settled = joinWords(settled, pending);
      pending = '';
      h.onText(settled, pending);
    }
    close();
  }));
  const appState = AppState.addEventListener('change', (s) => {
    if (s !== 'active') stop();
  });
  subs.push(appState);

  watchdog = setInterval(() => {
    const now = Date.now();
    if (now - lastActivity > SILENCE_STOP_MS || now - startedAt > MAX_SESSION_MS) stop();
  }, 1000);

  current = handle;
  try {
    m.start({
      lang,
      interimResults: true,
      // Android 12 and older cannot: there a session ends after the first pause.
      continuous: Platform.OS === 'ios' || (Platform.Version as number) >= 33,
      addsPunctuation: true,
      maxAlternatives: 1,
      iosTaskHint: 'dictation',
      volumeChangeEventOptions: { enabled: true, intervalMillis: LEVEL_INTERVAL_MS },
    });
  } catch {
    error = 'other';
    close();
    return null;
  }
  return { stop, cancel };
}
