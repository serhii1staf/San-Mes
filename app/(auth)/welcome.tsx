/**
 * Sign in and sign up, on one screen.
 *
 * Asked for, with a reference: the wordmark big on top, a black sheet with rounded corners at the bottom
 * holding a white pill and an outlined pill, "Войти" and "Зарегистрироваться". A tap slides the sheet up
 * and the fields then fade in on it. The top is a deep gradient rather than white.
 *
 *   Sign in:  paste the device key → the 4-digit code (signs in on the fourth digit).
 *   Sign up:  name and @username → emoji → code → the code again → the device key, to copy, then
 *             "Create account". The key is generated here and shown BEFORE the account is created, so
 *             nothing has to survive the user leaving the app to save it; the old flow never showed it.
 *
 * Everything moves on the UI thread, on React Native's native driver: one value `open` (0 welcome, 1 a
 * form) drives the sheet, the wordmark (it shrinks into the band above the sheet) and the glows; each
 * step fades and slides in as it mounts. Nothing animates at rest. The fields sit at the top of the
 * sheet, so the keyboard covers only empty sheet below them and nothing has to follow it.
 *
 * `/(auth)/login` and `/(auth)/register` redirect here with `mode`, which opens that form directly.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated as RNAnimated,
  BackHandler,
  Easing as RNEasing,
  Image,
  Keyboard,
  Linking,
  Platform,
  Pressable,
  Text as RNText,
  StyleSheet,
  TextInput,
  TouchableWithoutFeedback,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Text } from '../../src/components/ui';
import { EmojiPickerSheet, type EmojiSheetPalette } from '../../src/components/profile/EmojiPickerSheet';
import { emojiTextStyle } from '../../src/components/ui/emojiText';
import { AuthBackdrop } from '../../src/components/auth/AuthBackdrop';
import {
  Appear,
  AUTH,
  formatKey,
  KeyField,
  maskKey,
  PillButton,
  PinField,
  StepHeader,
  TextField,
  type PinFieldHandle,
} from '../../src/components/auth/AuthControls';
import { useAuthStore } from '../../src/store';
import { useSettingsStore } from '../../src/store/settingsStore';
import { loginUser, registerUser } from '../../src/lib/supabase';
import { useT } from '../../src/i18n/store';
import { validateName } from '../../src/services/moderation/index';

const WORDMARK = require('../../assets/brand/san-wordmark.png');
const WORDMARK_ASPECT = 894 / 348;
/** Height of the band above the sheet while a form is open (below the status bar). */
const BAND = 64;
const FORM_WORDMARK_HEIGHT = 26;
const OPEN = { duration: 560, easing: RNEasing.bezier(0.22, 1, 0.36, 1) };
const CLOSE = { duration: 460, easing: RNEasing.bezier(0.22, 1, 0.36, 1) };
const HELP_URL = 'https://legal.san-m-app.com/help.html';
const TERMS_URL = 'https://legal.san-m-app.com/terms.html';
const PRIVACY_URL = 'https://legal.san-m-app.com/privacy.html';

type Mode = 'welcome' | 'login' | 'register';
type Step = 'key' | 'pin' | 'name' | 'emoji' | 'newPin' | 'confirm' | 'reveal';
const REGISTER_STEPS: Step[] = ['name', 'emoji', 'newPin', 'confirm', 'reveal'];
const QUICK_EMOJI = ['😎', '🦊', '🐼', '🌸', '🔥', '🚀', '🐱', '👾'];
/**
 * «Другой эмодзи» opens the same sheet as the profile editor, in this screen's dark palette. It used
 * `EmojiPickerModal`, an older design that mounted every cell at once and so opened with a stall.
 */
const EMOJI_SHEET_PALETTE: EmojiSheetPalette = {
  card: '#141416',
  grabber: 'rgba(255,255,255,0.18)',
  title: AUTH.text,
  header: AUTH.text2,
  cellIdle: AUTH.field,
  cellActive: 'rgba(255,255,255,0.16)',
  accent: '#FFFFFF',
  previewBg: 'rgba(255,255,255,0.08)',
};

const BANNED_WORDS = [
  'fuck', 'shit', 'ass', 'bitch', 'dick', 'cock', 'pussy', 'nigger', 'nigga',
  'faggot', 'retard', 'whore', 'slut', 'cunt', 'rape', 'pedo', 'nazi',
  'hitler', 'kill', 'murder', 'terrorist', 'bomb', 'slave',
];
const hasBannedWord = (value: string) => {
  const lower = value.toLowerCase();
  return BANNED_WORDS.some((w) => lower.includes(w));
};
const nameValid = (v: string) => v.trim().length >= 2 && !hasBannedWord(v);
const usernameValid = (v: string) => v.length >= 4 && v.length <= 16 && !hasBannedWord(v);
const deriveUsername = (n: string) =>
  n.toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '').slice(0, 16);

/** 12 characters without I, O, 0 and 1, as before. */
function generateDeviceKey(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let key = '';
  for (let i = 0; i < 12; i++) key += chars[Math.floor(Math.random() * chars.length)];
  return key;
}

/** Transport failures arrive untranslated from authClient ("timeout", "Network request failed"). */
function isTransportError(e: string | null | undefined): boolean {
  if (!e) return false;
  return e === 'timeout' || e === 'unknown' || e === 'bad-shape' || e.startsWith('bad-json')
    || /network/i.test(e) || /failed to fetch/i.test(e);
}

function notify(kind: 'success' | 'error') {
  if (!useSettingsStore.getState().hapticEnabled) return;
  Haptics.notificationAsync(
    kind === 'success' ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error,
  ).catch(() => {});
}

export default function AuthScreen() {
  const t = useT();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ mode?: string }>();
  const signIn = useAuthStore((s) => s.login);

  const [size, setSize] = useState({ w: 0, h: 0 });
  const [welcomeHeight, setWelcomeHeight] = useState(0);
  const [mode, setMode] = useState<Mode>('welcome');
  const [step, setStep] = useState<Step>('key');
  const direction = useRef<1 | -1>(1);
  const firstStep = useRef(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [keyRaw, setKeyRaw] = useState('');
  const [pin, setPin] = useState('');
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [usernameEdited, setUsernameEdited] = useState(false);
  const [emoji, setEmoji] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [newKey, setNewKey] = useState('');
  const [copied, setCopied] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Stable, because the sheet's cells are memoised on them. Picking only flips `visible`; the sheet
  // runs its own close and calls `onClose` once it is gone, so there is exactly one exit animation.
  const closePicker = useCallback(() => setPickerOpen(false), []);
  const onPickEmoji = useCallback((e: string) => {
    setEmoji(e);
    setPickerOpen(false);
  }, []);

  const keyRef = useRef<TextInput>(null);
  const nameRef = useRef<TextInput>(null);
  const usernameRef = useRef<TextInput>(null);
  const pinRef = useRef<PinFieldHandle>(null);

  // ── Geometry and motion ─────────────────────────────────────────────────────
  //
  // React Native's Animated on the native driver, not Reanimated, for the sheet, the wordmark and the
  // glows. On Android, Reanimated 4 as configured here commits the shadow tree on every animated frame;
  // on the emulator that was 12-35 ms of every frame of this transition, the commits queued behind
  // each other, and frames of 60-120 ms followed. The native driver sets transform and opacity on the
  // views directly, on the UI thread. (Reanimated stays for the steps' layout animations and the PIN
  // shake: short, and one view each.)
  const open = useRef(new RNAnimated.Value(0)).current;
  const intro = useRef(new RNAnimated.Value(0)).current;
  const formFade = useRef(new RNAnimated.Value(0)).current;
  const introStarted = useRef(false);
  const ready = size.h > 0 && welcomeHeight > 0;
  const formTop = insets.top + BAND;
  // Until the welcome part is measured the sheet waits just below the screen.
  const welcomeTop = ready ? size.h - welcomeHeight : size.h;
  const wordmarkWidth = Math.min(size.w * 0.6, 250);
  const wordmarkHeight = wordmarkWidth / WORDMARK_ASPECT;
  const formScale = FORM_WORDMARK_HEIGHT / Math.max(1, wordmarkHeight);
  const focusY = insets.top + (welcomeTop - insets.top) / 2;
  const formFocusY = insets.top + BAND / 2;

  useEffect(() => {
    if (!ready || introStarted.current) return;
    introStarted.current = true;
    RNAnimated.timing(intro, { toValue: 1, duration: 760, easing: RNEasing.out(RNEasing.cubic), useNativeDriver: true }).start();
  }, [ready, intro]);

  const motion = useMemo(() => {
    // The sheet's layout top is `welcomeTop`; the entrance brings it up from below the screen, and
    // `open` takes it on up to `formTop`.
    const sheetY = RNAnimated.add(
      intro.interpolate({ inputRange: [0, 1], outputRange: [size.h - welcomeTop + 24, 0] }),
      open.interpolate({ inputRange: [0, 1], outputRange: [0, formTop - welcomeTop] }),
    );
    const wordmarkY = open.interpolate({
      inputRange: [0, 1],
      outputRange: [focusY - wordmarkHeight / 2, formFocusY - wordmarkHeight / 2],
    });
    const wordmarkScale = RNAnimated.multiply(
      open.interpolate({ inputRange: [0, 1], outputRange: [1, formScale] }),
      intro.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }),
    );
    return {
      sheet: { top: welcomeTop, transform: [{ translateY: sheetY }] },
      wordmark: { opacity: intro, transform: [{ translateY: wordmarkY }, { scale: wordmarkScale }] },
      // These two change only at the ends of the transition.
      welcome: { opacity: open.interpolate({ inputRange: [0, 0.22], outputRange: [1, 0], extrapolate: 'clamp' }) },
      back: { opacity: open.interpolate({ inputRange: [0.7, 1], outputRange: [0, 1], extrapolate: 'clamp' }) },
      help: { opacity: intro },
      form: { opacity: formFade },
    };
  }, [open, intro, formFade, size.h, welcomeTop, formTop, focusY, formFocusY, wordmarkHeight, formScale]);

  const onRootLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((prev) => (prev.w === width && prev.h === height ? prev : { w: width, h: height }));
  }, []);

  // ── Navigation between the welcome sheet, the forms and their steps ────────
  //
  // The form is mounted only once the sheet has risen, and unmounted only once it is down again.
  // Mounting it with the first frame of the rise (text inputs, icons, layout animations) cost the
  // Android emulator frames of 100-180 ms right as the sheet began to move; mounted afterwards, that
  // work lands while nothing moves, and the fields fade in on the risen sheet, as asked.
  const [formShown, setFormShown] = useState(false);

  const openMode = useCallback((next: 'login' | 'register') => {
    setError('');
    direction.current = 1;
    firstStep.current = true;
    setStep(next === 'login' ? 'key' : 'name');
    setMode(next);
    RNAnimated.timing(open, { toValue: 1, ...OPEN, useNativeDriver: true }).start(({ finished }) => {
      if (!finished) return;
      formFade.setValue(1);
      setFormShown(true);
    });
  }, [open, formFade]);

  const afterClose = useCallback(() => {
    setFormShown(false);
    setMode('welcome');
    setBusy(false);
    setKeyRaw('');
    setPin('');
    setNewPin('');
    setConfirmPin('');
  }, []);

  const closeToWelcome = useCallback(() => {
    Keyboard.dismiss();
    setError('');
    RNAnimated.parallel([
      RNAnimated.timing(formFade, { toValue: 0, duration: 140, useNativeDriver: true }),
      RNAnimated.timing(open, { toValue: 0, ...CLOSE, useNativeDriver: true }),
    ]).start(({ finished }) => {
      if (finished) afterClose();
    });
  }, [open, formFade, afterClose]);

  const goTo = useCallback((next: Step, dir: 1 | -1 = 1) => {
    direction.current = dir;
    firstStep.current = false;
    setError('');
    setStep(next);
  }, []);

  const back = useCallback(() => {
    if (busy) return;
    if (mode === 'login') {
      if (step === 'pin') {
        setPin('');
        goTo('key', -1);
      } else closeToWelcome();
      return;
    }
    const i = REGISTER_STEPS.indexOf(step);
    if (i <= 0) {
      closeToWelcome();
      return;
    }
    // Back to a code step: it is typed again (the confirmation, or both from the confirmation).
    if (step === 'confirm' || step === 'reveal') setConfirmPin('');
    if (step === 'confirm') setNewPin('');
    goTo(REGISTER_STEPS[i - 1], -1);
  }, [busy, mode, step, goTo, closeToWelcome]);

  useEffect(() => {
    if (mode === 'welcome') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      back();
      return true;
    });
    return () => sub.remove();
  }, [mode, back]);

  // Opened as /(auth)/login or /(auth)/register.
  const openedFromParams = useRef(false);
  useEffect(() => {
    if (!ready || openedFromParams.current) return;
    openedFromParams.current = true;
    if (params.mode === 'login' || params.mode === 'register') openMode(params.mode);
  }, [ready, params.mode, openMode]);

  // The field of each step takes focus once its entrance has played; steps without one drop the keyboard.
  useEffect(() => {
    if (mode === 'welcome' || !formShown) return;
    const id = setTimeout(() => {
      if (step === 'key') keyRef.current?.focus();
      else if (step === 'name') nameRef.current?.focus();
      else if (step === 'pin' || step === 'newPin' || step === 'confirm') pinRef.current?.focus();
      else Keyboard.dismiss();
    }, 300);
    return () => clearTimeout(id);
  }, [mode, step, formShown]);

  // ── Sign in ─────────────────────────────────────────────────────────────────
  const submitLogin = useCallback(async (code: string) => {
    if (busy || keyRaw.length < 6 || code.length !== 4) return;
    setBusy(true);
    setError('');
    const { profile, error: loginError } = await loginUser({ deviceKey: keyRaw, pin: code });
    if (loginError || !profile) {
      setBusy(false);
      setPin('');
      setError(isTransportError(loginError) ? t('auth.flow.error_network', 'Нет связи с сервером. Попробуй ещё раз.') : loginError || t('login.error.invalid'));
      pinRef.current?.shake();
      notify('error');
      setTimeout(() => pinRef.current?.focus(), 350);
      return;
    }
    notify('success');
    // Re-scope the cache and drop the previous account's data BEFORE the new user is set. And no
    // token here: authClient already stored the real JWT; see the note in authStore.login.
    const { switchAccount } = require('../../src/services/accountSwitch');
    switchAccount(profile.id);
    signIn({
      id: profile.id,
      username: profile.username,
      displayName: profile.display_name,
      emoji: profile.emoji,
      bio: profile.bio,
      pin: code,
      deviceKey: profile.device_key,
      badge: profile.badge || undefined,
      is_verified: profile.is_verified || false,
      bannerUrl: profile.banner_url || undefined,
      links: profile.links || undefined,
      screenshots_disabled: !!(profile as any).screenshots_disabled,
    });
    router.replace('/(tabs)');
  }, [busy, keyRaw, signIn, t]);

  // ── Sign up ─────────────────────────────────────────────────────────────────
  const onNameChange = (v: string) => {
    const next = v.slice(0, 24);
    setName(next);
    if (!usernameEdited) setUsername(deriveUsername(next));
    setError('');
  };
  const onUsernameChange = (v: string) => {
    setUsernameEdited(true);
    setUsername(v.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 16));
    setError('');
  };
  const nameStepValid = nameValid(name) && usernameValid(username);

  const continueFromName = () => {
    if (!nameStepValid) return;
    // The full moderation pipeline (NFKC, confusables, leet) before the name step is left.
    for (const value of [name, username]) {
      const check = validateName(value);
      if (!check.ok) {
        setError(t(check.reasonKey || 'moderation.reason.profanity'));
        return;
      }
    }
    goTo('emoji');
  };

  const onConfirmComplete = (value: string) => {
    if (value !== newPin) {
      notify('error');
      pinRef.current?.shake();
      setError(t('register.error.pins_mismatch'));
      setTimeout(() => setConfirmPin(''), 260);
      return;
    }
    if (!newKey) setNewKey(generateDeviceKey());
    setTimeout(() => goTo('reveal'), 160);
  };

  const submitRegister = useCallback(async () => {
    if (busy || !newKey) return;
    setBusy(true);
    setError('');
    const { profile, error: regError } = await registerUser({
      username: (username || deriveUsername(name) || 'user').slice(0, 16),
      displayName: name.trim(),
      emoji,
      pin: newPin,
      deviceKey: newKey,
    });
    if (regError || !profile) {
      setBusy(false);
      notify('error');
      const taken = t('auth.error.username_taken');
      if (regError === taken) {
        goTo('name', -1);
        setError(taken);
        return;
      }
      setError(isTransportError(regError)
        ? t('auth.flow.error_network', 'Нет связи с сервером. Попробуй ещё раз.')
        : t('auth.flow.error_register', 'Не удалось создать аккаунт. Попробуй ещё раз.'));
      return;
    }
    notify('success');
    const { switchAccount } = require('../../src/services/accountSwitch');
    switchAccount(profile.id);
    signIn({
      id: profile.id,
      username: profile.username,
      displayName: profile.display_name,
      emoji: profile.emoji,
      pin: newPin,
      deviceKey: profile.device_key,
      badge: profile.badge || undefined,
      is_verified: profile.is_verified || false,
    });
    router.replace('/(tabs)');
  }, [busy, newKey, username, name, emoji, newPin, signIn, t, goTo]);

  const copyKey = async () => {
    try {
      await Clipboard.setStringAsync(newKey);
      notify('success');
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  };

  // ── Steps ───────────────────────────────────────────────────────────────────
  // The first step of a form rises into place; later ones slide in from the side they come from. The
  // step being left goes at once: it is under the new one within a frame or two anyway.
  const enterFrom = firstStep.current ? 18 : direction.current > 0 ? 26 : -26;
  const enterAxis: 'x' | 'y' = firstStep.current ? 'y' : 'x';

  const errorLine = error ? (
    <Appear key={error} duration={180} style={styles.errorWrap}>
      <Text color={AUTH.error} style={styles.errorText}>{error}</Text>
    </Appear>
  ) : null;

  let content: React.ReactNode = null;
  if (mode === 'login' && step === 'key') {
    content = (
      <>
        <StepHeader
          title={t('login.title')}
          subtitle={t('auth.flow.login_key_subtitle', 'Вставь ключ устройства из Настроек на другом устройстве.')}
        />
        <KeyField
          ref={keyRef}
          value={keyRaw}
          onChange={(raw) => { setKeyRaw(raw); setError(''); }}
          onPasted={(raw) => { if (raw.length === 12) setTimeout(() => goTo('pin'), 260); }}
          onSubmit={() => { if (keyRaw.length >= 6) goTo('pin'); }}
          pasteLabel={t('auth.flow.paste', 'Вставить')}
        />
        {errorLine}
        <PillButton
          label={t('common.continue')}
          onPress={() => goTo('pin')}
          disabled={keyRaw.length < 6}
          style={styles.cta}
        />
      </>
    );
  } else if (mode === 'login' && step === 'pin') {
    content = (
      <>
        <StepHeader
          title={t('auth.flow.login_pin_title', 'Твой код')}
          subtitle={t('auth.flow.login_pin_subtitle', 'Введи 4-значный код')}
        />
        <PinField ref={pinRef} value={pin} onChange={(v) => { setPin(v); if (v) setError(''); }} onComplete={submitLogin} disabled={busy} error={!!error} />
        {busy ? <ActivityIndicator color="#FFFFFF" style={styles.spinner} /> : null}
        {errorLine}
        <Pressable onPress={back} style={styles.link} accessibilityRole="button">
          <Text color={AUTH.text2} style={styles.linkText}>{maskKey(keyRaw)}</Text>
          <Text weight="semibold" color={AUTH.text} style={styles.linkText}>  {t('auth.flow.change_key', 'Изменить')}</Text>
        </Pressable>
      </>
    );
  } else if (mode === 'register' && step === 'name') {
    content = (
      <>
        <StepHeader
          title={t('auth.flow.name_title', 'Как тебя зовут?')}
          subtitle={t('auth.flow.name_subtitle', 'Имя и юзернейм увидят собеседники.')}
        />
        <TextField
          ref={nameRef}
          value={name}
          onChangeText={onNameChange}
          placeholder={t('auth.flow.name_placeholder', 'Имя')}
          autoCapitalize="words"
          autoComplete="name"
          textContentType="givenName"
          returnKeyType="next"
          onSubmitEditing={() => usernameRef.current?.focus()}
        />
        <View style={styles.gap} />
        <TextField
          ref={usernameRef}
          value={username}
          onChangeText={onUsernameChange}
          placeholder="username"
          prefix="@"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          textContentType="username"
          returnKeyType="next"
          onSubmitEditing={continueFromName}
          right={username.length >= 4 ? (
            <Feather
              name={usernameValid(username) ? 'check-circle' : 'x-circle'}
              size={19}
              color={usernameValid(username) ? AUTH.ok : AUTH.error}
            />
          ) : null}
        />
        {errorLine}
        <PillButton label={t('common.continue')} onPress={continueFromName} disabled={!nameStepValid} style={styles.cta} />
      </>
    );
  } else if (mode === 'register' && step === 'emoji') {
    content = (
      <>
        <StepHeader
          title={t('auth.flow.emoji_title', 'Твой эмодзи')}
          subtitle={t('auth.flow.emoji_subtitle', 'Он будет твоим аватаром. Поменять можно в профиле.')}
        />
        <View style={styles.emojiRow}>
          <Pressable onPress={() => setPickerOpen(true)} style={styles.emojiCircle} accessibilityRole="button" accessibilityLabel={t('register.emoji_pick')}>
            {emoji ? (
              <Appear key={emoji} duration={160}>
                <RNText style={styles.emojiBig} allowFontScaling={false}>{emoji}</RNText>
              </Appear>
            ) : (
              <Feather name="plus" size={40} color={AUTH.text2} />
            )}
          </Pressable>
          <View style={styles.quickGrid}>
            {QUICK_EMOJI.map((e) => (
              <Pressable
                key={e}
                onPress={() => setEmoji(e)}
                style={[styles.quick, emoji === e && styles.quickOn]}
                accessibilityRole="button"
                accessibilityLabel={e}
              >
                <RNText style={styles.quickText} allowFontScaling={false}>{e}</RNText>
              </Pressable>
            ))}
          </View>
        </View>
        <Pressable onPress={() => setPickerOpen(true)} style={styles.link} accessibilityRole="button">
          <Text weight="semibold" color={AUTH.text} style={styles.linkText}>{t('auth.flow.more_emoji', 'Другой эмодзи')}</Text>
        </Pressable>
        <PillButton label={t('common.continue')} onPress={() => goTo('newPin')} disabled={!emoji} style={styles.cta} />
      </>
    );
  } else if (mode === 'register' && (step === 'newPin' || step === 'confirm')) {
    const confirming = step === 'confirm';
    content = (
      <>
        <StepHeader
          title={t(confirming ? 'register.confirm_pin_title' : 'register.pin_title')}
          subtitle={t(confirming ? 'register.confirm_pin_subtitle' : 'register.pin_subtitle')}
        />
        <PinField
          ref={pinRef}
          value={confirming ? confirmPin : newPin}
          onChange={(v) => { (confirming ? setConfirmPin : setNewPin)(v); if (v) setError(''); }}
          onComplete={confirming ? onConfirmComplete : () => setTimeout(() => goTo('confirm'), 160)}
          error={!!error}
        />
        {errorLine}
      </>
    );
  } else if (mode === 'register' && step === 'reveal') {
    content = (
      <>
        <StepHeader
          title={t('auth.flow.key_title', 'Твой ключ для входа')}
          subtitle={t('auth.flow.key_subtitle', 'Сохрани его. С ключом и кодом ты войдёшь на любом устройстве. Он есть и в Настройках.')}
        />
        <Pressable onPress={copyKey} style={styles.keyBox} accessibilityRole="button" accessibilityLabel={t('auth.flow.copy_key', 'Скопировать ключ')}>
          <RNText style={styles.keyText} selectable>{formatKey(newKey)}</RNText>
          <View style={styles.copyRow}>
            <Feather name={copied ? 'check' : 'copy'} size={15} color={copied ? AUTH.ok : AUTH.text2} />
            <Text weight="semibold" color={copied ? AUTH.ok : AUTH.text2} style={styles.copyText}>
              {copied ? t('device_key.copied') : t('auth.flow.copy_key', 'Скопировать ключ')}
            </Text>
          </View>
        </Pressable>
        {errorLine}
        <PillButton label={t('auth.flow.create', 'Создать аккаунт')} onPress={submitRegister} busy={busy} style={styles.cta} />
      </>
    );
  }

  const measured = size.h > 0;
  return (
    <View style={styles.root} onLayout={onRootLayout}>
      <StatusBar style="light" />
      <AuthBackdrop width={ready ? size.w : 0} focusY={focusY} riseBy={focusY - formFocusY} open={open} intro={intro} />

      {measured ? (
        <>
          <RNAnimated.View
            style={[styles.wordmarkWrap, { left: (size.w - wordmarkWidth) / 2, width: wordmarkWidth, height: wordmarkHeight }, motion.wordmark]}
            pointerEvents="none"
            accessible
            accessibilityRole="header"
            accessibilityLabel="San"
          >
            <Image source={WORDMARK} style={styles.wordmark} resizeMode="contain" />
          </RNAnimated.View>

          {/* Off screen until its welcome part has been measured, then it rises into place. */}
          <RNAnimated.View style={[styles.sheet, { height: size.h }, motion.sheet]}>
            <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
              <View style={StyleSheet.absoluteFill} />
            </TouchableWithoutFeedback>
            <RNAnimated.View
              onLayout={(e) => setWelcomeHeight(Math.ceil(e.nativeEvent.layout.height))}
              style={[styles.welcome, { paddingBottom: insets.bottom + 16 }, motion.welcome]}
              pointerEvents={mode === 'welcome' ? 'box-none' : 'none'}
            >
              <WelcomeButtons t={t} onOpen={openMode} />
            </RNAnimated.View>
            {formShown ? (
              <RNAnimated.View style={[styles.form, motion.form]} pointerEvents="box-none">
                <Appear key={`${mode}:${step}`} from={enterFrom} axis={enterAxis} duration={firstStep.current ? 320 : 260}>
                  {content}
                </Appear>
              </RNAnimated.View>
            ) : null}
          </RNAnimated.View>

          <View style={[styles.topBar, { top: insets.top + (BAND - 40) / 2 }]} pointerEvents="box-none">
            <RNAnimated.View style={motion.back} pointerEvents={mode === 'welcome' ? 'none' : 'auto'}>
              <Pressable onPress={back} hitSlop={8} style={styles.round} accessibilityRole="button" accessibilityLabel={t('common.back')}>
                <Feather name="chevron-left" size={24} color={AUTH.text} />
              </Pressable>
            </RNAnimated.View>
            <RNAnimated.View style={motion.help}>
              <Pressable
                onPress={() => Linking.openURL(HELP_URL).catch(() => {})}
                hitSlop={8}
                style={styles.round}
                accessibilityRole="button"
                accessibilityLabel="Help"
              >
                <Feather name="help-circle" size={20} color={AUTH.text2} />
              </Pressable>
            </RNAnimated.View>
          </View>
        </>
      ) : null}

      <EmojiPickerSheet
        visible={pickerOpen}
        selected={emoji}
        onPick={onPickEmoji}
        onClose={closePicker}
        palette={EMOJI_SHEET_PALETTE}
      />
    </View>
  );
}

function WelcomeButtons({ t, onOpen }: { t: ReturnType<typeof useT>; onOpen: (mode: 'login' | 'register') => void }) {
  return (
    <View>
      <PillButton label={t('auth.signin')} onPress={() => onOpen('login')} />
      <View style={styles.gap} />
      <PillButton label={t('auth.signup')} variant="outline" onPress={() => onOpen('register')} />
      <Text color={AUTH.text3} style={styles.policy}>
        {t('auth.policy_prefix')}{' '}
        <Text weight="semibold" color={AUTH.text2} style={styles.policy} onPress={() => Linking.openURL(TERMS_URL).catch(() => {})}>
          {t('auth.policy_terms')}
        </Text>{' '}
        {t('auth.policy_and')}{' '}
        <Text weight="semibold" color={AUTH.text2} style={styles.policy} onPress={() => Linking.openURL(PRIVACY_URL).catch(() => {})}>
          {t('auth.policy_privacy')}
        </Text>
        .
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: AUTH.backdrop },
  wordmarkWrap: { position: 'absolute', top: 0 },
  wordmark: { width: '100%', height: '100%' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    backgroundColor: AUTH.sheet,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
  },
  form: { position: 'absolute', left: 0, right: 0, top: 0, paddingHorizontal: 24, paddingTop: 28 },
  welcome: { position: 'absolute', left: 0, right: 0, top: 0, paddingHorizontal: 24, paddingTop: 28 },
  topBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    height: 40,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  round: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gap: { height: 12 },
  cta: { marginTop: 22 },
  policy: { fontSize: 12, lineHeight: 17, textAlign: 'center', marginTop: 18 },
  errorWrap: { marginTop: 14 },
  errorText: { fontSize: 14, lineHeight: 19, textAlign: 'center' },
  spinner: { marginTop: 22 },
  link: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 22, paddingVertical: 6 },
  linkText: { fontSize: 14 },
  // Sized so the eight quick picks make two rows of four from a 360 pt wide screen up.
  emojiRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  emojiCircle: {
    width: 104,
    height: 104,
    borderRadius: 52,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.32)',
    backgroundColor: AUTH.field,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // emojiTextStyle, not a bare fontSize: a colour emoji is taller than its point size, and on some
  // Android phones the default line box cut its top off. See src/components/ui/emojiText.ts.
  emojiBig: emojiTextStyle(56),
  quickGrid: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  quick: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: AUTH.field,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  quickOn: { borderColor: '#FFFFFF' },
  quickText: emojiTextStyle(22),
  keyBox: {
    borderRadius: 20,
    backgroundColor: AUTH.field,
    borderWidth: 1,
    borderColor: AUTH.fieldBorder,
    paddingVertical: 20,
    alignItems: 'center',
  },
  keyText: {
    color: AUTH.text,
    fontSize: 24,
    letterSpacing: 2,
    fontWeight: '700',
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: undefined }),
  },
  copyRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  copyText: { fontSize: 14 },
});
