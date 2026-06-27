import React, { memo, useState, useImperativeHandle, forwardRef, useCallback, useRef, useEffect } from 'react';
import { View, TextInput, Pressable, StyleSheet, Text, LayoutAnimation, UIManager, Platform } from 'react-native';
import Reanimated, { useSharedValue, useAnimatedStyle, withSpring, interpolate } from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { useT } from '../../i18n/store';
import { perfMonitor } from '../../services/perfMonitor';
import { useLiquidGlassActive, NativeGlassView, GlassContainerView } from '../ui/LiquidGlass';
import { AnimatedKeyboardIcon } from './AnimatedKeyboardIcon';
import { AnimatedEmojiIcon } from './AnimatedEmojiIcon';
import { AnimatedGifIcon } from './AnimatedGifIcon';

// Enable LayoutAnimation on Android (no-op on iOS where it's already on by
// default). Same pattern as app/comments/[id].tsx — needed for the one-shot
// expand/collapse layout animation fired at the 1↔multiline transition.
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

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

// Geometry of the photo/attach button slot. When the field expands (multiline)
// it slides LEFT over this slot so the growing input swallows the button.
const PHOTO_SLOT = 44;
const GAP = 8;
const BASE_PAD_LEFT = 14;
const SWALLOW_DX = PHOTO_SLOT + GAP; // 52 — how far the field's left edge travels
const EXPAND_PAD_LEFT = BASE_PAD_LEFT + SWALLOW_DX; // 66
// Distance (pt) within which the two glass surfaces start to liquid-merge.
// Smaller than GAP so the collapsed (8pt-apart) capsules stay separate, while
// the expanded overlap (≈0) clearly fuses them.
const GLASS_MERGE_SPACING = 4;

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
// bar, never the parent screen or the message FlatList.
//
// The "swallow": when the field grows to a 2nd line it slides LEFT over the
// photo button. The horizontal motion is one Reanimated shared value driving
// `marginRight` (photo) + `paddingLeft` (field content) in lock-step on the UI
// thread, so the text column stays pinned (no re-wrap) and nothing fights the
// (instant) height change — no jitter.
//
// The MERGE: when liquid glass is on, the photo + field glass surfaces live in
// a native `GlassContainer`, so as they overlap they FUSE into one glass shape
// (Apple's Liquid Glass union) — no separate capsule, no opacity fade (opacity
// on a GlassView is a documented no-render bug, which was the "delay" before).
// On non-glass devices the swallow is disabled — the capsules stay separate and
// static, which is rock-solid.

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
  onOpenGif: () => void;
  inputRowStyle: any; // Reanimated animated style (paddingBottom)
  // ── Emoji panel wiring (all optional — additive) ─────────────────────────
  // True while the parent's inline emoji panel is open. Swaps the GIF button
  // for a keyboard icon so the same slot returns the user to the keyboard.
  emojiOpen?: boolean;
  // True while the parent's inline GIF panel is open (twin of emojiOpen).
  gifOpen?: boolean;
  // Tapping the keyboard icon (or the text field while a panel is open)
  // asks the parent to close the panel and re-open the keyboard.
  onToggleEmoji?: () => void;
  // Tapping the top-left emoji button asks the parent to open the panel.
  onOpenEmoji?: () => void;
}

// ── Isolated text field (PER-KEYSTROKE RECONCILIATION FIX #4) ──────────────
//
// The <TextInput> + its local `text` state live HERE, in a memoized child, so a
// keystroke re-renders ONLY this component — never the parent's glass chrome
// (GlassContainerView + NativeGlassViews), the send button, or the overlays.
// The parent drives/observes text purely through this child's imperative handle
// (setText/clear/getText/insert/backspace/focus) and learns about send-enable
// transitions through `onHasTextChange`, which fires ONLY when the field flips
// between empty and non-empty (not on every keystroke), so the glass surfaces
// reconcile at most once per transition instead of per character.
interface ChatFieldHandle {
  setText: (text: string) => void;
  clear: () => void;
  getText: () => string;
  insert: (s: string) => void;
  backspace: () => void;
  focus: () => void;
}

interface ChatFieldProps {
  onContentSizeChange: (e: { nativeEvent: { contentSize: { height: number } } }) => void;
  // Fires only when emptiness flips (true ⇄ false) — drives `canSend` without a
  // per-keystroke parent render.
  onHasTextChange: (hasText: boolean) => void;
  onFocus: () => void;
  onPaste: (payload: any) => void;
}

const ChatField = memo(forwardRef<ChatFieldHandle, ChatFieldProps>(function ChatField(
  { onContentSizeChange, onHasTextChange, onFocus, onPaste },
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

  const handleChangeText = useCallback((val: string) => setText(val), []);

  const textInputEl = (
    <TextInput
      ref={textInputRef}
      value={text}
      onChangeText={handleChangeText}
      placeholder={t('chat.input_placeholder')}
      placeholderTextColor={theme.colors.text.tertiary}
      style={{ flex: 1, fontSize: 15, color: theme.colors.text.primary, fontFamily: theme.fontFamily.regular, maxHeight: 100, paddingTop: 0, paddingBottom: 0, minHeight: 22, lineHeight: 20, alignSelf: 'stretch', textAlign: 'left' }}
      multiline
      textAlignVertical="center"
      autoCorrect={false}
      autoComplete="off"
      spellCheck={false}
      onContentSizeChange={onContentSizeChange}
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
  { isEditing, hasPendingImages, onSend, onPickImages, onPasteImage, onPasteImages, onOpenGif, inputRowStyle, emojiOpen, gifOpen, onToggleEmoji, onOpenEmoji },
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

  // Swallow progress 0→1 (UI thread). Runs on BOTH glass and flat now — on
  // glass the surfaces liquid-merge; on flat the photo capsule slides under the
  // opaque field (lower zIndex) so the field simply covers it. Either way the
  // expansion + the top-left emoji button behave identically.
  const sw = useSharedValue(0);
  const expandedRef = useRef(false);
  const setExpanded = useCallback((next: boolean) => {
    if (next === expandedRef.current) return;
    expandedRef.current = next;
    // EXPAND RE-RENDER FIX (#2): no JS state flip here anymore — the emoji
    // overlay's interactivity is derived from `sw` on the UI thread (see
    // emojiBtnStyle), so expanding no longer reconciles the glass surfaces.
    // SLOW SWALLOW SPRING FIX (#3): snappier spring (was damping 17 / stiffness
    // 120 / mass 0.8 ≈ 500-700ms) so it settles quickly but still feels liquid.
    sw.value = withSpring(next ? 1 : 0, { damping: 24, stiffness: 260, mass: 0.7, overshootClamping: false });
  }, [sw]);

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
  const handleFieldFocus = useCallback(() => {
    perfMonitor.markInputFocus('chat');
    // Tapping the field while a panel is open should close it and return to the
    // keyboard (which is already coming up).
    if (emojiOpenRef.current || gifOpenRef.current) onToggleEmojiRef.current?.();
  }, []);

  const handleHasTextChange = useCallback((next: boolean) => setHasText(next), []);

  useImperativeHandle(ref, () => ({
    setText: (val: string) => { fieldRef.current?.setText(val); if (!val) setExpanded(false); },
    clear: () => { fieldRef.current?.clear(); lastHeightRef.current = 0; setExpanded(false); },
    getText: () => fieldRef.current?.getText() ?? '',
    insert: (s: string) => { fieldRef.current?.insert(s); },
    backspace: () => { fieldRef.current?.backspace(); },
    focus: () => { fieldRef.current?.focus(); },
  }), [setExpanded]);

  const canSend = hasText || hasPendingImages;

  const handleSend = useCallback(() => {
    const val = fieldRef.current?.getText() ?? '';
    // Match prior behavior: clear text WITHOUT forcing collapse (the field's
    // content-size change collapses it via hysteresis as the text shrinks).
    fieldRef.current?.setText('');
    onSend(val);
  }, [onSend]);

  // Detect 1↔multi-line with hysteresis (expand >34px, collapse <28px). At the
  // 1↔multiline TRANSITION (and ONLY then) we fire a single, gentle one-shot
  // LayoutAnimation so the input wrap's height/position eases smoothly as it
  // grows/collapses. This is a ONE-SHOT layout commit (≈170ms easeInEaseOut),
  // NOT a per-frame interpolation, so it does NOT reintroduce the per-frame
  // liquid-glass union recompute the perf comments warn about — it animates the
  // single layout change at the toggle, exactly like app/comments/[id].tsx.
  // The per-frame `sw`/glass-swallow + emoji-reveal logic below is untouched.
  const lastHeightRef = useRef(0);
  const handleContentSizeChange = useCallback((e: { nativeEvent: { contentSize: { height: number } } }) => {
    const h = Math.round(e.nativeEvent.contentSize.height);
    if (h === lastHeightRef.current) return;
    lastHeightRef.current = h;
    if (!expandedRef.current && h > 34) {
      LayoutAnimation.configureNext(LayoutAnimation.create(170, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity));
      setExpanded(true);
    } else if (expandedRef.current && h < 28) {
      LayoutAnimation.configureNext(LayoutAnimation.create(170, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity));
      setExpanded(false);
    }
  }, [setExpanded]);

  // PERCEIVED-LAG FIX (glass only) ─────────────────────────────────────────
  // The swallow used to drive LAYOUT props (`marginRight` on the photo wrapper
  // + `paddingLeft` on the field) via `interpolate(sw.value, …)` EVERY spring
  // frame. Those views live inside a native `GlassContainerView`, so each
  // frame forced the liquid-glass union to recompute its merged shape — a very
  // expensive UIVisualEffectView relayout ~60×/spring. That per-frame recompute
  // is the expand lag users feel on glass devices.
  //
  // The two endpoints have DIFFERENT glass merge states (collapsed = two
  // separate capsules 8pt apart; expanded = fused), so the field's left edge
  // genuinely changes width — no pure `translateX` can reproduce both ends
  // without either leaving a gap at the field's (fixed) right edge or poking
  // the photo capsule out past the expanded field. And smoothly translating the
  // glass *background* itself would require an extra animated style on the field
  // wrapper, which the preserve-exact-hook-count constraint forbids.
  //
  // So on glass we take the sanctioned path: keep the live merge SUSPENDED
  // during the spring and snap the layout exactly ONCE per transition (a single
  // glass-union recompute instead of one every frame). `marginRight` and
  // `paddingLeft` flip together at the same tiny threshold, so the field's left
  // edge (52→0) and its left padding (14→66) change in lock-step and the text
  // column stays pinned at the same absolute x across the snap — no text jump,
  // no re-wrap. The emoji reveal still rides `sw` smoothly (unchanged below),
  // and because the snap lands while the wrapper is already at its expanded
  // origin, the emoji fades in cleanly at its final position. Both rest states
  // (sw=0 and sw=1) are pixel-identical to before.
  //
  // The FLAT (non-glass) path slides under an opaque view (cheap, no glass), so
  // it keeps the original smooth per-frame interpolation untouched.
  const photoWrapStyle = useAnimatedStyle(() =>
    glassActive
      ? { marginRight: sw.value > 0.02 ? -PHOTO_SLOT : GAP }
      : { marginRight: interpolate(sw.value, [0, 1], [GAP, -PHOTO_SLOT]) },
  );
  const fieldPadStyle = useAnimatedStyle(() =>
    glassActive
      ? { paddingLeft: sw.value > 0.02 ? EXPAND_PAD_LEFT : BASE_PAD_LEFT }
      : { paddingLeft: interpolate(sw.value, [0, 1], [BASE_PAD_LEFT, EXPAND_PAD_LEFT]) },
  );
  // Emoji button reveal — tied to the SAME `sw` expansion shared value so it
  // fades + scales in on the UI thread exactly as the field expands to 2+
  // lines, and out as it collapses. `pointerEvents` rides `sw` too (#2): the
  // button is interactive ONLY while visible (sw>0), so the fully transparent
  // collapsed button can never intercept taps over the text — and there is NO
  // JS re-render driving it.
  const emojiBtnStyle = useAnimatedStyle(() => ({
    opacity: sw.value,
    transform: [{ scale: interpolate(sw.value, [0, 1], [0.55, 1]) }],
    pointerEvents: sw.value > 0.01 ? 'auto' : 'none',
  }));

  // Field content (TextInput + GIF) with the animated left padding that keeps
  // the text pinned while the field swallows the button. The TextInput lives in
  // the memoized <ChatField> so keystrokes don't reconcile this glass chrome.
  const fieldContent = (
    <Reanimated.View style={[styles.fieldContent, fieldPadStyle]}>
      <ChatField
        ref={fieldRef}
        onContentSizeChange={handleContentSizeChange}
        onHasTextChange={handleHasTextChange}
        onFocus={handleFieldFocus}
        onPaste={handleNativePaste}
      />
      {emojiOpen || gifOpen ? (
        // A panel is open → this slot returns the user to the keyboard. Fixed
        // height matches the GIF state so swapping GIF↔keyboard never resizes
        // the field (no "text shifts up" jump).
        <Pressable onPress={onToggleEmoji} hitSlop={8} style={{ alignSelf: 'flex-end', marginLeft: 6, height: 24, paddingHorizontal: 7, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.accent.primary + '18' }}>
          <AnimatedKeyboardIcon size={18} color={theme.colors.accent.primary} />
        </Pressable>
      ) : (
        <Pressable onPress={onOpenGif} hitSlop={8} style={{ alignSelf: 'flex-end', marginLeft: 6, height: 24, paddingHorizontal: 7, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.accent.primary + '18' }}>
          <AnimatedGifIcon color={theme.colors.accent.primary} fontSize={11} />
        </Pressable>
      )}
    </Reanimated.View>
  );

  // Emoji button — overlaid at the field's TOP-LEFT, OUTSIDE the padded
  // `fieldContent` so the animated left padding can't shove it over the text.
  // It anchors to the field wrapper's own left edge. Opacity/scale AND
  // pointerEvents ride `sw` on the UI thread (visible + tappable when sw>0,
  // inert when collapsed). Rendered as a sibling inside each field wrapper.
  const emojiOverlay = (
    <Reanimated.View style={[styles.emojiBtnWrap, emojiBtnStyle]}>
      <Pressable onPress={onOpenEmoji} hitSlop={8} style={styles.emojiBtn}>
        <AnimatedEmojiIcon size={22} color={theme.colors.accent.primary} />
      </Pressable>
    </Reanimated.View>
  );

  const photoIcon = <Feather name="image" size={20} color={theme.colors.accent.primary} />;

  return (
    <Reanimated.View style={[styles.row, inputRowStyle]}>
      {glassActive ? (
        // GLASS: photo + field glass live in a GlassContainer so they FUSE as
        // the field slides over the button (liquid union). No opacity anywhere.
        <GlassContainerView spacing={GLASS_MERGE_SPACING} style={styles.glassGroup}>
          <Reanimated.View style={[styles.photoWrap, photoWrapStyle]}>
            <Pressable onPress={onPickImages} onLongPress={onPasteImage} delayLongPress={300} style={styles.photoBtn}>
              <NativeGlassView glassStyle="regular" isInteractive colorScheme={theme.isDark ? 'dark' : 'light'} style={styles.capsuleFill}>
                {photoIcon}
              </NativeGlassView>
            </Pressable>
          </Reanimated.View>
          <NativeGlassView glassStyle="regular" isInteractive colorScheme={theme.isDark ? 'dark' : 'light'} style={styles.inputWrapGlass}>
            {fieldContent}
            {emojiOverlay}
          </NativeGlassView>
        </GlassContainerView>
      ) : (
        // FLAT (no glass): same swallow geometry, but the photo capsule slides
        // UNDER the opaque field (lower zIndex) so the field "covers" it — no
        // liquid merge, but the expansion + emoji button work identically.
        <>
          <Reanimated.View style={[styles.photoWrap, styles.photoWrapFlat, photoWrapStyle]}>
            <Pressable onPress={onPickImages} onLongPress={onPasteImage} delayLongPress={300} style={[styles.photoBtn, styles.iconBtnFlat, { backgroundColor: theme.colors.background.elevated, borderColor: theme.colors.border.light }]}>
              {photoIcon}
            </Pressable>
          </Reanimated.View>
          <View style={[styles.inputWrap, styles.inputWrapFlatZ, { backgroundColor: theme.colors.background.elevated, borderColor: theme.colors.border.light }]}>
            {fieldContent}
            {emojiOverlay}
          </View>
        </>
      )}
      {/* Send button. */}
      {glassActive && !canSend ? (
        <Pressable onPress={handleSend} style={{ borderRadius: 22, marginLeft: 8 }}>
          <NativeGlassView glassStyle="regular" isInteractive colorScheme={theme.isDark ? 'dark' : 'light'} style={styles.btnGlass}>
            <Feather name={isEditing ? 'check' : 'send'} size={18} color={theme.colors.text.tertiary} />
          </NativeGlassView>
        </Pressable>
      ) : (
        <Pressable onPress={handleSend} style={[styles.sendBtn, { backgroundColor: canSend ? theme.colors.accent.primary : theme.colors.background.elevated }]}>
          <Feather name={isEditing ? 'check' : 'send'} size={18} color={canSend ? '#FFFFFF' : theme.colors.text.tertiary} />
        </Pressable>
      )}
    </Reanimated.View>
  );
}));

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 12, paddingTop: 8 },
  // Glass group holds the photo + field glass so the GlassContainer can fuse
  // them. Send button stays OUTSIDE so it never merges.
  glassGroup: { flex: 1, flexDirection: 'row', alignItems: 'flex-end' },
  photoWrap: { alignSelf: 'flex-end', zIndex: 2 },
  // Flat path: photo sits UNDER the opaque field so the field covers it on overlap.
  photoWrapFlat: { zIndex: 0 },
  photoBtn: { width: PHOTO_SLOT, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  iconBtnFlat: { borderWidth: 1 },
  inputWrapFlatZ: { zIndex: 1 },
  capsuleFill: { width: '100%', height: '100%', borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  center: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  iconBtn: { width: PHOTO_SLOT, height: 44, borderRadius: 22, borderWidth: 1, alignSelf: 'flex-end', marginRight: GAP },
  fieldContent: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  emojiBtnWrap: { position: 'absolute', left: 8, top: 3, zIndex: 3 },
  emojiBtn: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  inputWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', borderRadius: 22, paddingRight: 14, paddingVertical: 10, minHeight: 44, borderWidth: 1 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  btnGlass: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  inputWrapGlass: { flex: 1, flexDirection: 'row', alignItems: 'center', borderRadius: 22, paddingRight: 14, paddingVertical: 10, minHeight: 44 },
});
