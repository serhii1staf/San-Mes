/**
 * Voice dictation in the chat composer (the recording and the transcription are
 * src/services/dictation.ts).
 *
 * Asked for: our own voice input instead of the keyboard's, "the field starts to glow a little along
 * its edge" while it listens, a delete button on the left, and the best performance on every device.
 *
 *   [photo]  [ field .................. ☺ ]  (mic)        empty field, this binary may record
 *   [bin]    [ field, glowing ......... ☺ ]  (|||)        recording: the bars move with the voice
 *   [bin]    [ field, glowing ......... ☺ ]  ( ◌ )        turning the recording into text
 *
 * The mic takes the place of the empty field's send button. While recording that place is the stop
 * button, and the photo button is the bin, which throws the recording away. After stop the text
 * arrives a moment later (Whisper on our server, see the service), at the end of whatever is in the
 * field by then, so nothing typed meanwhile is lost.
 *
 * Cost: the glow is three static rings and the bars three small views, animated by opacity and scale
 * on the UI thread from one level value written about ten times a second. Nothing is blurred,
 * measured or laid out while it records. The rings stay mounted (invisible) so the glow fades in and out.
 */
import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Keyboard, Linking, Pressable, StyleSheet, View } from 'react-native';
import Reanimated, { Easing, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { useT } from '../../i18n/store';
import { withOpacity } from '../../constants/bubbleColors';
import {
  dictationAvailable,
  grantDictationConsent,
  hasDictationConsent,
  startDictation,
  type DictationError,
  type DictationSession,
} from '../../services/dictation';

const GLOW_IN = { duration: 260, easing: Easing.out(Easing.quad) };
const GLOW_OUT = { duration: 220, easing: Easing.out(Easing.quad) };
const LEVEL_TIMING = { duration: 120, easing: Easing.out(Easing.quad) };

type FieldLike = { getText: () => string; setText: (text: string) => void };
type T = (key: string, fallback?: string) => string;

export type DictationPhase = 'idle' | 'recording' | 'transcribing';

export interface ChatDictation {
  /** This binary may record. Decided once per composer. */
  available: boolean;
  phase: DictationPhase;
  /** Recording or transcribing: the bar is in its dictation shape. */
  dictating: boolean;
  /** 0..1: the glow in and out. */
  on: SharedValue<number>;
  /** 0..1: the voice's level. */
  level: SharedValue<number>;
  start: () => void;
  /** Stop recording and turn it into text. A no-op when not recording. */
  stop: () => void;
  /** Throw the recording away. */
  cancel: () => void;
}

function tellUser(t: T, error: DictationError, settingsOnly?: boolean) {
  if (error === 'permission') {
    Alert.alert(
      t('chat.dictation.no_access_title', 'Нет доступа к микрофону'),
      t('chat.dictation.no_access_body', 'Чтобы диктовать сообщения, разрешите San микрофон в Настройках.'),
      settingsOnly
        ? [
            { text: t('common.cancel', 'Отмена'), style: 'cancel' },
            { text: t('chat.dictation.open_settings', 'Настройки'), onPress: () => { void Linking.openSettings(); } },
          ]
        : undefined,
    );
    return;
  }
  const body =
    error === 'network'
      ? t('chat.dictation.network', 'Нет связи с сервером. Попробуйте ещё раз.')
      : error === 'limit'
        ? t('chat.dictation.limit', 'На сегодня голосовой ввод закончился. Завтра он снова будет доступен.')
        : t('chat.dictation.failed', 'Не получилось распознать речь. Попробуйте ещё раз.');
  Alert.alert(t('chat.dictation.failed_title', 'Голосовой ввод'), body);
}

export function useChatDictation(field: React.RefObject<FieldLike | null>, onTyping?: () => void): ChatDictation {
  const t = useT() as T;
  const [available] = useState(dictationAvailable);
  const [phase, setPhase] = useState<DictationPhase>('idle');
  const on = useSharedValue(0);
  const level = useSharedValue(0);
  const session = useRef<DictationSession | null>(null);
  const busy = useRef(false);
  const mounted = useRef(true);
  const onTypingRef = useRef(onTyping);
  onTypingRef.current = onTyping;
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // Leaving the chat closes the microphone and drops a transcription still on its way.
      session.current?.cancel();
      session.current = null;
    };
  }, []);

  const begin = useCallback(() => {
    if (busy.current || session.current) return;
    busy.current = true;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      (require('../../utils/haptics') as typeof import('../../utils/haptics')).triggerHaptic('light');
    } catch {}
    // Recording without the keyboard: the field is for the words that come back.
    Keyboard.dismiss();
    setPhase('recording');
    on.value = withTiming(1, GLOW_IN);
    let locale: string | undefined;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      locale = (require('../../i18n/store') as typeof import('../../i18n/store')).useI18nStore.getState().locale;
    } catch {}
    void startDictation((locale || 'ru').slice(0, 2), {
      onLevel: (v) => {
        level.value = withTiming(v, LEVEL_TIMING);
      },
      onTranscribing: () => {
        if (!mounted.current) return;
        setPhase('transcribing');
        level.value = withTiming(0, GLOW_OUT);
      },
      onText: (text) => {
        if (!mounted.current) return;
        // At the end of whatever is in the field now: typed meanwhile, it stays.
        const now = field.current?.getText() ?? '';
        const sep = now && !/\s$/.test(now) ? ' ' : '';
        field.current?.setText(now + sep + text);
        onTypingRef.current?.();
      },
      onEnd: ({ cancelled, error, settingsOnly, nothingHeard }) => {
        session.current = null;
        busy.current = false;
        if (!mounted.current) return;
        setPhase('idle');
        on.value = withTiming(0, GLOW_OUT);
        level.value = withTiming(0, GLOW_OUT);
        if (cancelled) return;
        if (error) tellUser(tRef.current, error, settingsOnly);
        else if (nothingHeard) {
          Alert.alert(
            tRef.current('chat.dictation.failed_title', 'Голосовой ввод'),
            tRef.current('chat.dictation.nothing', 'Не удалось разобрать слова. Попробуйте ещё раз, ближе к телефону.'),
          );
        }
      },
    }).then((s) => {
      busy.current = false;
      if (!s) return;
      if (!mounted.current) {
        s.cancel();
        return;
      }
      session.current = s;
    });
  }, [field, on, level]);

  const start = useCallback(() => {
    if (busy.current || session.current) return;
    if (hasDictationConsent()) {
      begin();
      return;
    }
    // Once per account, before anything is recorded (App Review 5.1.2: say where it goes, then ask).
    const tt = tRef.current;
    Alert.alert(
      tt('chat.dictation.consent_title', 'Голосовой ввод'),
      tt(
        'chat.dictation.consent_body',
        'Пока вы говорите, San записывает голос. Когда вы остановитесь, запись уходит на наш сервер, и модель распознавания речи Whisper, которую для нас запускает Cloudflare, превращает её в текст. Запись не хранится ни у нас, ни у Cloudflare и сразу удаляется с телефона. В сообщение попадает только текст.',
      ),
      [
        { text: tt('common.cancel', 'Отмена'), style: 'cancel' },
        {
          text: tt('chat.dictation.consent_ok', 'Продолжить'),
          onPress: () => {
            grantDictationConsent();
            begin();
          },
        },
      ],
    );
  }, [begin]);

  const stop = useCallback(() => {
    session.current?.stop();
  }, []);
  const cancel = useCallback(() => {
    session.current?.cancel();
  }, []);

  return { available, phase, dictating: phase !== 'idle', on, level, start, stop, cancel };
}

/**
 * The glow around the field while it records: a ring at its edge and two soft ones outside it, all
 * brighter as the voice gets louder. `right` is where the field's surface ends (the send slot).
 */
export const DictationGlow = memo(function DictationGlow({
  on, level, color, right, radius,
}: {
  on: SharedValue<number>;
  level: SharedValue<number>;
  color: string;
  right: number;
  radius: number;
}) {
  const ringStyle = useAnimatedStyle(() => ({ opacity: on.value * (0.6 + 0.4 * level.value) }));
  const haloStyle = useAnimatedStyle(() => ({ opacity: on.value * (0.25 + 0.75 * level.value) }));
  return (
    <>
      <Reanimated.View
        pointerEvents="none"
        style={[styles.ring, { inset: -1, right: right - 1, borderRadius: radius + 1, borderColor: color }, ringStyle]}
      />
      <Reanimated.View
        pointerEvents="none"
        style={[styles.halo, { inset: -4, right: right - 4, borderRadius: radius + 4, borderColor: withOpacity(color, 0.32) }, haloStyle]}
      />
      <Reanimated.View
        pointerEvents="none"
        style={[styles.halo, { inset: -7, right: right - 7, borderRadius: radius + 7, borderColor: withOpacity(color, 0.12) }, haloStyle]}
      />
    </>
  );
});

/**
 * The button in the send place while dictating: the accent circle with three bars that move with the
 * voice (tap: stop), then a spinner while the recording is turned into text.
 */
export const DictationStopButton = memo(function DictationStopButton({
  level, color, size, label, busy, onPress,
}: {
  level: SharedValue<number>;
  color: string;
  size: number;
  label: string;
  busy: boolean;
  onPress: () => void;
}) {
  const a = useAnimatedStyle(() => ({ transform: [{ scaleY: 0.32 + 0.68 * Math.min(1, level.value * 0.8) }] }));
  const b = useAnimatedStyle(() => ({ transform: [{ scaleY: 0.32 + 0.68 * Math.min(1, level.value * 1.3) }] }));
  const c = useAnimatedStyle(() => ({ transform: [{ scaleY: 0.32 + 0.68 * Math.min(1, level.value) }] }));
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      hitSlop={6}
      style={[styles.stop, { width: size, height: size, borderRadius: size / 2, backgroundColor: color }]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy }}
    >
      {busy ? (
        <ActivityIndicator color="#FFFFFF" />
      ) : (
        <View style={styles.bars}>
          <Reanimated.View style={[styles.bar, a]} />
          <Reanimated.View style={[styles.bar, b]} />
          <Reanimated.View style={[styles.bar, c]} />
        </View>
      )}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  ring: { position: 'absolute', borderWidth: 1.5 },
  halo: { position: 'absolute', borderWidth: 3 },
  stop: { alignItems: 'center', justifyContent: 'center' },
  bars: { flexDirection: 'row', alignItems: 'center', gap: 3, height: 20 },
  bar: { width: 3.5, height: 20, borderRadius: 2, backgroundColor: '#FFFFFF' },
});
