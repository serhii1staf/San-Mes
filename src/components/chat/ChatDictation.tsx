/**
 * Voice dictation in the chat composer (the recogniser itself is src/services/dictation.ts).
 *
 * Asked for: our own voice input instead of the keyboard's, "the field starts to glow a little along
 * its edge" while it listens, a delete button on the left, and the best performance on every device.
 *
 *   [photo]  [ field .................. ☺ ]  (mic)        empty field, dictation available
 *   [trash]  [ field, glowing ......... ☺ ]  (|||)        listening: words appear as they are heard
 *
 * The mic takes the place of the empty field's send button; while listening that place is the stop
 * button, its bars moving with the voice, and the photo button turns into the bin, which throws away
 * what this session added. A tap on the field also stops, so the text can be edited.
 *
 * Cost: the glow is three static rings and the bars three small views, all animated by opacity and
 * scale on the UI thread from one level value that changes about eight times a second. Nothing is
 * blurred, measured or laid out while it listens; the only JS work is the field's text update for
 * each recognised word. The rings stay mounted (invisible) so the glow can fade in and out.
 */
import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Keyboard, Linking, Pressable, StyleSheet, View } from 'react-native';
import Reanimated, { Easing, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { useT } from '../../i18n/store';
import { withOpacity } from '../../constants/bubbleColors';
import {
  dictationAvailable,
  dictationLang,
  joinWords,
  startDictation,
  type DictationError,
  type DictationSession,
} from '../../services/dictation';

const GLOW_IN = { duration: 260, easing: Easing.out(Easing.quad) };
const GLOW_OUT = { duration: 220, easing: Easing.out(Easing.quad) };
const LEVEL_TIMING = { duration: 140, easing: Easing.out(Easing.quad) };

type FieldLike = { getText: () => string; setText: (text: string) => void };

export interface ChatDictation {
  /** This binary has the module and the phone a recogniser. Decided once per composer. */
  available: boolean;
  dictating: boolean;
  /** 0..1: the glow in and out. */
  on: SharedValue<number>;
  /** 0..1: the voice's level. */
  level: SharedValue<number>;
  start: () => void;
  /** Keep the words. A no-op when not listening. */
  stop: () => void;
  /** Throw this session's words away. */
  cancel: () => void;
}

type T = (key: string, fallback?: string) => string;

function tellUser(t: T, error: DictationError, settingsOnly?: boolean) {
  if (error === 'permission') {
    Alert.alert(
      t('chat.dictation.no_access_title', 'Нет доступа к микрофону'),
      t('chat.dictation.no_access_body', 'Чтобы диктовать сообщения, разрешите San микрофон и распознавание речи в Настройках.'),
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
    error === 'language'
      ? t('chat.dictation.language', 'Голосовой ввод на этом языке недоступен на устройстве.')
      : error === 'network'
        ? t('chat.dictation.network', 'Для распознавания речи нужен интернет.')
        : error === 'unavailable'
          ? t('chat.dictation.unavailable', 'Распознавание речи на этом устройстве выключено.')
          : t('chat.dictation.failed', 'Не получилось распознать речь. Попробуйте ещё раз.');
  Alert.alert(t('chat.dictation.failed_title', 'Голосовой ввод'), body);
}

export function useChatDictation(field: React.RefObject<FieldLike | null>, onTyping?: () => void): ChatDictation {
  const t = useT() as T;
  const [available] = useState(dictationAvailable);
  const [dictating, setDictating] = useState(false);
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
      // Leaving the chat closes the microphone.
      session.current?.cancel();
      session.current = null;
    };
  }, []);

  const start = useCallback(() => {
    if (busy.current || session.current) return;
    busy.current = true;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      (require('../../utils/haptics') as typeof import('../../utils/haptics')).triggerHaptic('light');
    } catch {}
    // Listening without the keyboard: typed keys would be overwritten by the words that follow.
    Keyboard.dismiss();
    const base = field.current?.getText() ?? '';
    const sep = base && !/\s$/.test(base) ? ' ' : '';
    setDictating(true);
    on.value = withTiming(1, GLOW_IN);
    let locale: string | undefined;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      locale = (require('../../i18n/store') as typeof import('../../i18n/store')).useI18nStore.getState().locale;
    } catch {}
    void startDictation(dictationLang(locale), {
      onText: (settled, pending) => {
        if (!mounted.current) return;
        const spoken = joinWords(settled, pending);
        field.current?.setText(spoken ? base + sep + spoken : base);
        onTypingRef.current?.();
      },
      onLevel: (v) => {
        level.value = withTiming(v, LEVEL_TIMING);
      },
      onEnd: ({ cancelled, error, settingsOnly }) => {
        session.current = null;
        busy.current = false;
        if (!mounted.current) return;
        setDictating(false);
        on.value = withTiming(0, GLOW_OUT);
        level.value = withTiming(0, GLOW_OUT);
        if (cancelled) field.current?.setText(base);
        if (error) tellUser(tRef.current, error, settingsOnly);
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

  const stop = useCallback(() => {
    session.current?.stop();
  }, []);
  const cancel = useCallback(() => {
    session.current?.cancel();
  }, []);

  return { available, dictating, on, level, start, stop, cancel };
}

/**
 * The glow around the field while it listens: a ring at its edge and two soft ones outside it, all
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

/** The stop button while listening: the accent circle with three bars that move with the voice. */
export const DictationStopButton = memo(function DictationStopButton({
  level, color, size, label, onPress,
}: {
  level: SharedValue<number>;
  color: string;
  size: number;
  label: string;
  onPress: () => void;
}) {
  const a = useAnimatedStyle(() => ({ transform: [{ scaleY: 0.32 + 0.68 * Math.min(1, level.value * 0.8) }] }));
  const b = useAnimatedStyle(() => ({ transform: [{ scaleY: 0.32 + 0.68 * Math.min(1, level.value * 1.3) }] }));
  const c = useAnimatedStyle(() => ({ transform: [{ scaleY: 0.32 + 0.68 * Math.min(1, level.value) }] }));
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      style={[styles.stop, { width: size, height: size, borderRadius: size / 2, backgroundColor: color }]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={styles.bars}>
        <Reanimated.View style={[styles.bar, a]} />
        <Reanimated.View style={[styles.bar, b]} />
        <Reanimated.View style={[styles.bar, c]} />
      </View>
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
