import React, { memo, useState, useImperativeHandle, forwardRef, useCallback, useRef, useEffect } from 'react';
import { View, TextInput, Pressable, StyleSheet } from 'react-native';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolate,
  Easing,
  LinearTransition,
} from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { useT } from '../../i18n/store';
import { perfMonitor } from '../../services/perfMonitor';
import { MAX_MESSAGE_CHARS } from '../../utils/textLimits';
import { useLiquidGlassActive, NativeGlassView } from '../ui/LiquidGlass';
import { AnimatedKeyboardIcon } from './AnimatedKeyboardIcon';
import { AnimatedEmojiIcon } from './AnimatedEmojiIcon';
import { DictationGlow, DictationStopButton, useChatDictation } from './ChatDictation';

// ── How the composer grows (and the two ways it was broken) ────────────────
//
// The field height is INTRINSIC: the multiline TextInput measures itself between
// its own `minHeight: 22` and `maxHeight: 100`, and the field around it simply
// sizes to that content. Nothing in JS owns the number.
//
// Two previous attempts both regressed this, so the reasoning is recorded here:
//
//   1. `LayoutAnimation.configureNext(...)` on every content-size change. This
//      is the wrong tool on the New Architecture (`newArchEnabled: true`):
//      Fabric does not honour it the way the old renderer did, which is almost
//      certainly why the "smooth grow" it was supposed to cushion read as a hard
//      snap in the first place.
//   2. Replacing the intrinsic height with an explicit animated `height` driven
//      by `onContentSizeChange`. That PINS the wrapper: the TextInput is
//      `alignSelf: 'stretch'`, so a fixed parent height forces its frame, and
//      growth then depends entirely on that one callback landing. When it
//      didn't, the composer stopped growing at all — the reported "поле ввода не
//      расширяется".
//
// So: no explicit height, and cushioning comes from a Reanimated LAYOUT
// TRANSITION, which is the Fabric-correct mechanism. It animates the view's real
// measured frame, so the field still grows even if the transition is a no-op.
// Growth is structural; the animation is only polish on top of it.
const FIELD_HEIGHT_TRANSITION = LinearTransition.duration(170).easing(
  Easing.out(Easing.quad),
);

// ── Layout (Nov 2026 redesign) ──────────────────────────────────────────────
//
//   [photo]  [ field ..................... ☺ ]  [send]      empty
//   [photo]  [ field ..................... ☺  (send) ]       typing
//
// The photo button always stays outside on the left. The emoji button lives in
// the field (it replaced the GIF chip: GIFs are one tab away in the panel it
// opens). The send button is a round glass button outside the field while the
// field is empty; as soon as there is something to send, the field's surface
// grows over the button's place and a wider accent "pill" appears inside the
// field's right end, the way Telegram does it.
//
// What this replaced, and why: the field used to slide LEFT over the photo
// button on the second line (the "swallow"), with an emoji button fading in at
// its top-left. That relied on the system glass MERGING the two surfaces inside
// a GlassContainer. Our own glass (SanGlass) has no merging: each surface shows
// what is beneath it, so the photo circle stayed visible through the expanded
// field, which is the "leftover rounded button" that was reported.
//
// The field's LAYOUT box never changes width. It always spans to the row's right
// edge and reserves the send button's slot as right padding, so the text column
// is the same width in both states (no re-wrap, and the height transition above
// never fires for the typing change). Only the absolutely positioned surface
// behind the content moves its right edge, and only the buttons fade. The
// surface is the first child, so neither glass implementation captures the
// buttons drawn after it.
const BTN = 44; // the round buttons (photo, send)
const GAP = 8; // between the photo button, the field and the send button
const SEND_SLOT = BTN + GAP; // 52: how far the field's surface grows to the right
const FIELD_PAD = 14;
const SEND_PILL_W = 48;
const SEND_PILL_H = 32;
const SEND_PILL_INSET = (BTN - SEND_PILL_H) / 2; // 6: centred on a one-line field
const TYPING_TIMING = { duration: 240, easing: Easing.out(Easing.cubic) };

// Delete the last user-perceived character (grapheme) from a string. Handles
// astral emoji (surrogate pairs), variation selectors, skin-tone modifiers and
// ZWJ-joined sequences (👨‍👩‍👧, ❤️‍🔥, 🏳️‍🌈) so one backspace removes one emoji.
function deleteLastGrapheme(s: string): string {
  if (!s) return s;
  const cps = Array.from(s); // code points (surrogate pairs collapse to 1)
  if (cps.length === 0) return s;
  const isMod = (cp: string) => {
    const c = cp.codePointAt(0) || 0;
    return (
      c === 0xfe0f || c === 0xfe0e || // variation selectors
      (c >= 0x1f3fb && c <= 0x1f3ff) || // skin-tone modifiers
      (c >= 0x0300 && c <= 0x036f) // combining marks
    );
  };
  cps.pop(); // drop the last code point
  // Then unwind any modifiers / ZWJ chains that were attached to it.
  while (cps.length > 0) {
    const last = cps[cps.length - 1];
    const c = last.codePointAt(0) || 0;
    if (c === 0x200d) { // ZWJ → also drop the base it joined to
      cps.pop();
      if (cps.length > 0) cps.pop();
    } else if (isMod(last)) {
      cps.pop();
    } else {
      break;
    }
  }
  return cps.join('');
}

// ── Native paste wrapper (expo-paste-input) — crash-safe SYNC load ─────────
//
// PERF / FOCUS-STEALING REMOUNT FIX (#1): the wrapper used to be lazy-loaded in
// a `useEffect` and flipped into state, which UNMOUNTED the bare <TextInput>
// and MOUNTED a fresh one inside the wrapper — if that landed on the first tap,
// focus/keyboard was dropped (the "dead first tap"). Instead we resolve the
// native wrapper SYNCHRONOUSLY (and cache it module-wide) on first access, so
// the TextInput's tree position is decided BEFORE the first paint and never
// changes for the life of the field → no remount, taps always focus instantly.
//
// Crash-safety is preserved: on older binaries that lack the native view
// (`ExpoPasteInput`), `requireNativeView` throws while the module evaluates —
// we swallow it and fall back to the plain TextInput, exactly as before.
let pasteWrapperResolved = false;
let cachedPasteWrapper: React.ComponentType<any> | null = null;
function loadPasteWrapper(): React.ComponentType<any> | null {
  if (pasteWrapperResolved) return cachedPasteWrapper;
  pasteWrapperResolved = true;
  try {
    const m = require('expo-paste-input');
    cachedPasteWrapper = m && m.TextInputWrapper ? m.TextInputWrapper : null;
  } catch {
    cachedPasteWrapper = null;
  }
  return cachedPasteWrapper;
}

// ── Isolated chat input bar ───────────────────────────────────────────────
//
// Performance: owns the text-input state LOCALLY so typing re-renders only this
// bar, never the parent screen or the message list.

export interface ChatInputBarHandle {
  setText: (text: string) => void;
  clear: () => void;
  getText: () => string;
  // Append a string (emoji) to the local text state — used by the parent's
  // emoji panel so picks land in the composer without re-rendering the screen.
  insert: (s: string) => void;
  // Delete the last grapheme (whole emoji, incl. ZWJ/skin-tone sequences) —
  // used by the media panel's backspace button.
  backspace: () => void;
  // Programmatically focus the TextInput (re-open the keyboard).
  focus: () => void;
}

interface ChatInputBarProps {
  isEditing: boolean;
  hasPendingImages: boolean;
  onSend: (text: string) => void;
  onPickImages: () => void;
  onPasteImage?: () => void;
  // Native paste (expo-paste-input): local file:// URIs of pasted media.
  onPasteImages?: (uris: string[]) => void;
  inputRowStyle: any; // Reanimated animated style (paddingBottom)
  // ── Media panel wiring ────────────────────────────────────────────────────
  // True while the parent's emoji / GIF panel is open. Either one swaps the
  // emoji button for a keyboard icon that returns the user to the keyboard.
  emojiOpen?: boolean;
  gifOpen?: boolean;
  // Tapping the keyboard icon (or the text field while a panel is open)
  // asks the parent to close the panel and re-open the keyboard.
  onToggleEmoji?: () => void;
  // Tapping the emoji button asks the parent to open the panel (emoji tab; the
  // panel's own switcher leads to the GIFs).
  onOpenEmoji?: () => void;
  // Called on every keystroke so the screen can broadcast a typing indicator.
  // MUST be a stable, state-free callback — see the note on `ChatFieldProps.onTyping`.
  onTyping?: () => void;
}

// ── Isolated text field (PER-KEYSTROKE RECONCILIATION FIX #4) ──────────────
//
// The <TextInput> + its local `text` state live HERE, in a memoized child, so a
// keystroke re-renders ONLY this component — never the parent's glass chrome or
// the buttons. The parent drives/observes text purely through this child's
// imperative handle (setText/clear/getText/insert/backspace/focus) and learns
// about send-enable transitions through `onHasTextChange`, which fires ONLY when
// the field flips between empty and non-empty (not on every keystroke), so the
// chrome reconciles at most once per transition instead of per character.
interface ChatFieldHandle {
  setText: (text: string) => void;
  clear: () => void;
  getText: () => string;
  insert: (s: string) => void;
  backspace: () => void;
  focus: () => void;
}

interface ChatFieldProps {
  // Fires only when emptiness flips (true ⇄ false) — drives `canSend` without a
  // per-keystroke parent render.
  onHasTextChange: (hasText: boolean) => void;
  // Shown instead of the placeholder while dictating ("Говорите…", "Распознаю…"). Changes twice a
  // session, so it costs the field two renders.
  hint?: string;
  onFocus: () => void;
  onPaste: (payload: any) => void;
  // Fires on EVERY keystroke, unlike `onHasTextChange`. Safe only because the
  // implementation is a stable, state-free callback that throttles internally
  // (see `useTypingPublisher`); a handler that set state here would reintroduce
  // the per-keystroke parent render this whole component exists to avoid.
  onTyping?: () => void;
}

const ChatField = memo(forwardRef<ChatFieldHandle, ChatFieldProps>(function ChatField(
  { onHasTextChange, onFocus, onPaste, onTyping, hint },
  ref,
) {
  const theme = useTheme();
  const t = useT();
  const [text, setText] = useState('');
  const textInputRef = useRef<TextInput>(null);
  // Resolved ONCE, synchronously — the wrapper (or null) never changes, so the
  // TextInput below keeps a stable tree position and never remounts (#1).
  const [PasteWrapper] = useState(() => loadPasteWrapper());

  // Notify the parent only when emptiness flips — keeps the glass chrome out of
  // the per-keystroke render path while keeping send-enable correct (#4).
  const hadTextRef = useRef(false);
  useEffect(() => {
    const has = text.trim().length > 0;
    if (has !== hadTextRef.current) {
      hadTextRef.current = has;
      onHasTextChange(has);
    }
  }, [text, onHasTextChange]);

  useImperativeHandle(ref, () => ({
    setText: (val: string) => setText(val),
    clear: () => setText(''),
    getText: () => text,
    insert: (s: string) => setText((prev) => prev + s),
    backspace: () => setText((prev) => deleteLastGrapheme(prev)),
    focus: () => { textInputRef.current?.focus(); },
  }), [text]);

  const handleChangeText = useCallback((val: string) => {
    setText(val);
    // Announce typing from the change handler rather than an effect on `text`: an effect
    // would also fire for programmatic `setText` (opening the edit composer, inserting an
    // emoji, backspacing from the media panel), none of which is the user typing.
    if (val.length > 0) onTyping?.();
  }, [onTyping]);

  const textInputEl = (
    <TextInput
      ref={textInputRef}
      value={text}
      onChangeText={handleChangeText}
      placeholder={hint ?? t('chat.input_placeholder')}
      placeholderTextColor={hint ? theme.colors.accent.primary : theme.colors.text.tertiary}
      style={{ flex: 1, fontSize: 15, color: theme.colors.text.primary, fontFamily: theme.fontFamily.regular, maxHeight: 100, paddingTop: 0, paddingBottom: 0, minHeight: 22, lineHeight: 20, alignSelf: 'stretch', textAlign: 'left' }}
      // There was NO limit here. The only bound was the server truncating at 16 000 after the
      // fact, which loses text silently, and before that a single pasted wall of text is one
      // enormous bubble for the list to measure on every pass. See src/utils/textLimits.ts.
      maxLength={MAX_MESSAGE_CHARS}
      multiline
      textAlignVertical="center"
      autoCorrect={false}
      autoComplete="off"
      spellCheck={false}
      onFocus={onFocus}
    />
  );

  // Tree shape is identical on both branches from the very first render (the
  // wrapper decision is fixed at mount), so the TextInput never remounts.
  return PasteWrapper ? (
    <PasteWrapper style={{ flex: 1 }} onPaste={onPaste}>
      {textInputEl}
    </PasteWrapper>
  ) : (
    textInputEl
  );
}));

export const ChatInputBar = memo(forwardRef<ChatInputBarHandle, ChatInputBarProps>(function ChatInputBar(
  { isEditing, hasPendingImages, onSend, onPickImages, onPasteImage, onPasteImages, inputRowStyle, emojiOpen, gifOpen, onToggleEmoji, onOpenEmoji, onTyping },
  ref,
) {
  const theme = useTheme();
  const t = useT();
  const glassActive = useLiquidGlassActive();
  // Imperative handle to the isolated text field. The parent screen's handle
  // forwards to this; keystrokes never reach the parent render path.
  const fieldRef = useRef<ChatFieldHandle>(null);
  // Lightweight mirror of "field has text" — flips at most once per empty⇄
  // non-empty transition (see ChatField.onHasTextChange), NOT per keystroke.
  const [hasText, setHasText] = useState(false);
  const canSend = hasText || hasPendingImages;
  // Voice input (see ChatDictation): the mic in the empty field's send place, and while it listens
  // the stop button there, so the field keeps its short shape until it stops.
  const dictation = useChatDictation(fieldRef, onTyping);
  const sendMode = canSend && !dictation.dictating;

  // 0 = nothing to send (round send button outside), 1 = something to send (the
  // field's surface covers that place and the pill inside it is shown). Driven
  // once per flip, on the UI thread.
  const typing = useSharedValue(sendMode ? 1 : 0);
  const typingTargetRef = useRef(sendMode);
  useEffect(() => {
    if (typingTargetRef.current === sendMode) return;
    typingTargetRef.current = sendMode;
    typing.value = withTiming(sendMode ? 1 : 0, TYPING_TIMING);
  }, [sendMode, typing]);

  // Native paste payload → parent. Stable so the memoized ChatField never
  // re-renders just because the bar re-rendered.
  const handleNativePaste = useCallback((payload: any) => {
    if (payload?.type === 'images' && Array.isArray(payload.uris) && payload.uris.length > 0) {
      onPasteImages?.(payload.uris);
    }
  }, [onPasteImages]);

  // Latest panel state held in refs so the field's focus handler can stay a
  // STABLE callback (keeps ChatField from re-rendering on panel toggles).
  const emojiOpenRef = useRef(emojiOpen);
  emojiOpenRef.current = emojiOpen;
  const gifOpenRef = useRef(gifOpen);
  gifOpenRef.current = gifOpen;
  const onToggleEmojiRef = useRef(onToggleEmoji);
  onToggleEmojiRef.current = onToggleEmoji;
  const stopDictationRef = useRef(dictation.stop);
  stopDictationRef.current = dictation.stop;
  const handleFieldFocus = useCallback(() => {
    perfMonitor.markInputFocus('chat');
    // A tap on the field while recording stops it; the words arrive at the end of what is typed.
    stopDictationRef.current();
    // Tapping the field while a panel is open should close it and return to the
    // keyboard (which is already coming up).
    if (emojiOpenRef.current || gifOpenRef.current) onToggleEmojiRef.current?.();
  }, []);

  const handleHasTextChange = useCallback((next: boolean) => setHasText(next), []);

  useImperativeHandle(ref, () => ({
    setText: (val: string) => { fieldRef.current?.setText(val); },
    clear: () => { fieldRef.current?.clear(); },
    getText: () => fieldRef.current?.getText() ?? '',
    insert: (s: string) => { fieldRef.current?.insert(s); },
    backspace: () => { fieldRef.current?.backspace(); },
    focus: () => { fieldRef.current?.focus(); },
  }), []);

  const handleSend = useCallback(() => {
    const val = fieldRef.current?.getText() ?? '';
    fieldRef.current?.setText('');
    onSend(val);
  }, [onSend]);

  // The field's surface: its right edge runs from the send button's slot to the
  // row's edge. The text column does not move (see the layout note at the top).
  const surfaceStyle = useAnimatedStyle(() => ({
    right: interpolate(typing.value, [0, 1], [SEND_SLOT, 0], 'clamp'),
  }));
  // The round send button is covered by the growing surface and fades out early…
  const outerSendStyle = useAnimatedStyle(() => ({
    opacity: interpolate(typing.value, [0, 0.55], [1, 0], 'clamp'),
    transform: [{ scale: interpolate(typing.value, [0, 1], [1, 0.6], 'clamp') }],
  }));
  // …and the pill inside the field comes in late, once there is surface under it.
  const innerSendStyle = useAnimatedStyle(() => ({
    opacity: interpolate(typing.value, [0.35, 1], [0, 1], 'clamp'),
    transform: [{ scale: interpolate(typing.value, [0, 1], [0.6, 1], 'clamp') }],
  }));

  const panelOpen = !!(emojiOpen || gifOpen);
  const sendIcon = isEditing ? 'check' : 'send';
  const sendLabel = isEditing ? t('chat.composer.save_a11y', 'Сохранить') : t('chat.composer.send_a11y', 'Отправить');
  const scheme = theme.isDark ? 'dark' : 'light';
  const flatSurface = { backgroundColor: theme.colors.background.elevated, borderColor: theme.colors.border.light };

  // While dictating the photo button is the bin: it throws away what this session added.
  const leftIcon = dictation.dictating ? 'trash-2' : 'image';
  const leftColor = dictation.dictating ? theme.colors.text.primary : theme.colors.accent.primary;
  const showMic = dictation.available && !dictation.dictating;

  return (
    <Reanimated.View style={[styles.row, inputRowStyle]}>
      <Pressable
        onPress={dictation.dictating ? dictation.cancel : onPickImages}
        onLongPress={dictation.dictating ? undefined : onPasteImage}
        delayLongPress={300}
        style={styles.roundBtn}
        accessibilityRole="button"
        accessibilityLabel={dictation.dictating ? t('chat.composer.dictate_cancel_a11y', 'Удалить надиктованное') : t('chat.composer.attach_a11y', 'Прикрепить фото')}
      >
        {glassActive ? (
          <NativeGlassView glassStyle="regular" colorScheme={scheme} style={styles.roundFill}>
            <Feather name={leftIcon} size={20} color={leftColor} />
          </NativeGlassView>
        ) : (
          <View style={[styles.roundFill, styles.flatBorder, flatSurface]}>
            <Feather name={leftIcon} size={20} color={leftColor} />
          </View>
        )}
      </Pressable>

      <View style={styles.field} testID="composer-field">
        {/* The surface. First child, so it is beneath everything else in the field. */}
        <Reanimated.View pointerEvents="none" style={[styles.surface, surfaceStyle]}>
          {glassActive ? (
            <NativeGlassView glassStyle="regular" colorScheme={scheme} style={styles.surfaceFill} />
          ) : (
            <View style={[styles.surfaceFill, styles.flatBorder, flatSurface]} />
          )}
        </Reanimated.View>
        {/* Around the surface while it listens; invisible otherwise. The surface keeps its short
            shape then (`sendMode`), so its right edge is the send slot. */}
        {dictation.available ? (
          <DictationGlow on={dictation.on} level={dictation.level} color={theme.colors.accent.primary} right={SEND_SLOT} radius={BTN / 2} />
        ) : null}

        {/* The content. No `height` anywhere: the row is whatever the TextInput
            measures, and `layout` only eases the change (see the top of the file). */}
        <Reanimated.View style={styles.fieldContent} layout={FIELD_HEIGHT_TRANSITION}>
          <ChatField
            ref={fieldRef}
            onTyping={onTyping}
            onHasTextChange={handleHasTextChange}
            onFocus={handleFieldFocus}
            onPaste={handleNativePaste}
            hint={
              dictation.phase === 'recording'
                ? t('chat.dictation.listening', 'Говорите…')
                : dictation.phase === 'transcribing'
                  ? t('chat.dictation.transcribing', 'Распознаю…')
                  : undefined
            }
          />
          <Pressable
            onPress={panelOpen ? onToggleEmoji : onOpenEmoji}
            hitSlop={10}
            style={styles.emojiBtn}
            accessibilityRole="button"
            accessibilityLabel={panelOpen ? t('chat.composer.keyboard_a11y', 'Клавиатура') : t('chat.composer.emoji_a11y', 'Эмодзи и GIF')}
          >
            {panelOpen ? (
              <AnimatedKeyboardIcon size={22} color={theme.colors.accent.primary} />
            ) : (
              <AnimatedEmojiIcon size={22} color={theme.colors.text.secondary} />
            )}
          </Pressable>
        </Reanimated.View>

        {/* The pill inside the field: shown while there is something to send. */}
        <Reanimated.View
          testID="composer-send-pill"
          pointerEvents={sendMode ? 'auto' : 'none'}
          style={[styles.innerSendWrap, innerSendStyle]}
          accessibilityElementsHidden={!sendMode}
          importantForAccessibility={sendMode ? 'auto' : 'no-hide-descendants'}
        >
          <Pressable
            onPress={handleSend}
            hitSlop={6}
            style={[styles.innerSend, { backgroundColor: theme.colors.accent.primary }]}
            accessibilityRole="button"
            accessibilityLabel={sendLabel}
          >
            <Feather name={sendIcon} size={17} color="#FFFFFF" />
          </Pressable>
        </Reanimated.View>

        {/* The round button outside the field, while it is empty: the mic when this phone can
            dictate (send otherwise), and the stop button while it listens. */}
        <Reanimated.View
          testID="composer-send-round"
          pointerEvents={sendMode ? 'none' : 'auto'}
          style={[styles.outerSendWrap, outerSendStyle]}
          accessibilityElementsHidden={sendMode}
          importantForAccessibility={sendMode ? 'no-hide-descendants' : 'auto'}
        >
          {dictation.dictating ? (
            <DictationStopButton
              level={dictation.level}
              color={theme.colors.accent.primary}
              size={BTN}
              label={t('chat.composer.dictate_stop_a11y', 'Остановить голосовой ввод')}
              busy={dictation.phase === 'transcribing'}
              onPress={dictation.stop}
            />
          ) : (
            <Pressable
              onPress={showMic ? dictation.start : handleSend}
              style={styles.roundBtn}
              accessibilityRole="button"
              accessibilityLabel={showMic ? t('chat.composer.dictate_a11y', 'Голосовой ввод') : sendLabel}
            >
              {glassActive ? (
                <NativeGlassView glassStyle="regular" colorScheme={scheme} style={styles.roundFill}>
                  <Feather name={showMic ? 'mic' : sendIcon} size={showMic ? 19 : 18} color={showMic ? theme.colors.accent.primary : theme.colors.text.tertiary} />
                </NativeGlassView>
              ) : (
                <View style={[styles.roundFill, styles.flatBorder, flatSurface]}>
                  <Feather name={showMic ? 'mic' : sendIcon} size={showMic ? 19 : 18} color={showMic ? theme.colors.accent.primary : theme.colors.text.tertiary} />
                </View>
              )}
            </Pressable>
          )}
        </Reanimated.View>
      </View>
    </Reanimated.View>
  );
}));

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 12, paddingTop: 8 },
  roundBtn: { width: BTN, height: BTN, borderRadius: BTN / 2 },
  roundFill: { width: '100%', height: '100%', borderRadius: BTN / 2, alignItems: 'center', justifyContent: 'center' },
  flatBorder: { borderWidth: 1 },
  // The layout box: always as wide as the row allows, with the send slot kept as
  // padding so the text column never changes width.
  field: {
    flex: 1,
    marginLeft: GAP,
    minHeight: BTN,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: FIELD_PAD,
    paddingRight: FIELD_PAD + SEND_SLOT,
    paddingVertical: 10,
  },
  surface: { position: 'absolute', left: 0, top: 0, bottom: 0 },
  surfaceFill: { ...StyleSheet.absoluteFillObject, borderRadius: BTN / 2 },
  fieldContent: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  emojiBtn: { alignSelf: 'flex-end', marginLeft: 6, width: 26, height: 24, alignItems: 'center', justifyContent: 'center' },
  innerSendWrap: { position: 'absolute', right: SEND_PILL_INSET, bottom: SEND_PILL_INSET },
  innerSend: { width: SEND_PILL_W, height: SEND_PILL_H, borderRadius: SEND_PILL_H / 2, alignItems: 'center', justifyContent: 'center' },
  outerSendWrap: { position: 'absolute', right: 0, bottom: 0 },
});
