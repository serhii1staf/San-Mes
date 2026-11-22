/**
 * The controls of the sign-in / sign-up screen (app/(auth)/welcome.tsx): white and outlined pills, text
 * fields, the device-key field with a paste button, and the four PIN boxes.
 *
 * Always dark, whatever the app theme: the screen is the brand's own (white wordmark, black sheet), and
 * it follows the dark launch screen without a flash. Every motion here is React Native's Animated on
 * the native driver (transform and opacity set on the views directly), for the reason given in
 * welcome.tsx: Reanimated's per-frame commit measured 12-35 ms a frame on the Android emulator.
 */
import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Text } from '../ui';
import { triggerHaptic } from '../../utils/haptics';

export const AUTH = {
  backdrop: '#05040B',
  sheet: '#000000',
  text: '#FFFFFF',
  text2: 'rgba(255,255,255,0.62)',
  text3: 'rgba(255,255,255,0.36)',
  field: 'rgba(255,255,255,0.07)',
  fieldBorder: 'rgba(255,255,255,0.10)',
  fieldFocus: 'rgba(255,255,255,0.36)',
  error: '#FF6B6B',
  ok: '#34C759',
} as const;

const KEY_FONT = Platform.select({ ios: 'Menlo', android: 'monospace', default: undefined });

/** Upper-case letters and digits only, as the server stores the key. */
export function normaliseKey(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 64);
}

/** "ABCDEFGHJKLM" → "ABC-DEF-GHJ-KLM", the way Settings shows it. */
export function formatKey(raw: string): string {
  return (raw.match(/.{1,3}/g) ?? []).join('-');
}

/** "ABC-•••-•••-KLM": enough to recognise the key on the code step, not enough to read it off. */
export function maskKey(raw: string): string {
  const groups = formatKey(raw).split('-');
  if (groups.length <= 2) return groups.join('-');
  return [groups[0], ...groups.slice(1, -1).map(() => '•••'), groups[groups.length - 1]].join('-');
}

// ─── Entrance ────────────────────────────────────────────────────────────────

/** Fades its children in once, on mount, from `from` (pt) along x or y. */
export function Appear({
  children, from = 0, axis = 'y', duration = 260, style,
}: {
  children: React.ReactNode;
  from?: number;
  axis?: 'x' | 'y';
  duration?: number;
  style?: ViewStyle;
}) {
  const p = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(p, { toValue: 1, duration, useNativeDriver: true }).start();
  }, [p, duration]);
  const shift = p.interpolate({ inputRange: [0, 1], outputRange: [from, 0] });
  return (
    <Animated.View
      style={[style, { opacity: p, transform: [axis === 'x' ? { translateX: shift } : { translateY: shift }] }]}
    >
      {children}
    </Animated.View>
  );
}

// ─── Pill button ─────────────────────────────────────────────────────────────

export function PillButton({
  label,
  onPress,
  variant = 'filled',
  disabled,
  busy,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: 'filled' | 'outline';
  disabled?: boolean;
  busy?: boolean;
  style?: ViewStyle;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const filled = variant === 'filled';
  const inert = disabled || busy;
  const pressTo = (to: number, duration: number) =>
    Animated.timing(scale, { toValue: to, duration, useNativeDriver: true }).start();
  return (
    <Pressable
      onPress={() => {
        if (inert) return;
        triggerHaptic('light');
        onPress();
      }}
      onPressIn={() => { if (!inert) pressTo(0.965, 90); }}
      onPressOut={() => pressTo(1, 180)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, busy: !!busy }}
      style={style}
    >
      <Animated.View
        style={[
          styles.pill,
          filled ? styles.pillFilled : styles.pillOutline,
          disabled && (filled ? styles.pillFilledOff : styles.pillOutlineOff),
          { transform: [{ scale }] },
        ]}
      >
        {busy ? (
          <ActivityIndicator color={filled ? '#000000' : '#FFFFFF'} />
        ) : (
          <Text
            weight="semibold"
            color={filled ? (disabled ? 'rgba(255,255,255,0.45)' : '#000000') : disabled ? AUTH.text3 : AUTH.text}
            style={styles.pillLabel}
          >
            {label}
          </Text>
        )}
      </Animated.View>
    </Pressable>
  );
}

// ─── Header ──────────────────────────────────────────────────────────────────

export function StepHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={styles.header}>
      <Text weight="bold" color={AUTH.text} style={styles.title}>
        {title}
      </Text>
      {subtitle ? (
        <Text color={AUTH.text2} style={styles.subtitle}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

// ─── Text field ──────────────────────────────────────────────────────────────

type TextFieldProps = Omit<TextInputProps, 'style'> & {
  prefix?: string;
  right?: React.ReactNode;
  inputStyle?: TextInputProps['style'];
};

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { prefix, right, inputStyle, onFocus, onBlur, ...input },
  ref,
) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={[styles.field, focused && styles.fieldFocused]}>
      {prefix ? (
        <Text color={AUTH.text3} style={styles.prefix}>
          {prefix}
        </Text>
      ) : null}
      <TextInput
        ref={ref}
        placeholderTextColor={AUTH.text3}
        selectionColor="#FFFFFF"
        cursorColor="#FFFFFF"
        keyboardAppearance="dark"
        {...input}
        onFocus={(e) => { setFocused(true); onFocus?.(e); }}
        onBlur={(e) => { setFocused(false); onBlur?.(e); }}
        style={[styles.input, inputStyle]}
      />
      {right}
    </View>
  );
});

// ─── Device key ──────────────────────────────────────────────────────────────

/**
 * The device key, formatted in groups of three as it is typed or pasted. Pasting goes through the
 * system paste control on iOS 16+, which needs no "Allow Paste" prompt; elsewhere through a chip.
 */
export const KeyField = forwardRef<TextInput, {
  value: string;
  onChange: (raw: string) => void;
  onPasted?: (raw: string) => void;
  onSubmit?: () => void;
  pasteLabel: string;
}>(function KeyField({ value, onChange, onPasted, onSubmit, pasteLabel }, ref) {
  const paste = (text: string) => {
    const raw = normaliseKey(text);
    if (!raw) return;
    triggerHaptic('selection');
    onChange(raw);
    onPasted?.(raw);
  };
  let right: React.ReactNode = null;
  if (value) {
    right = (
      <Pressable onPress={() => onChange('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear" style={styles.clear}>
        <Feather name="x" size={16} color={AUTH.text2} />
      </Pressable>
    );
  } else if (Platform.OS === 'ios' && Clipboard.isPasteButtonAvailable) {
    right = (
      <Clipboard.ClipboardPasteButton
        onPress={(data) => { if (data.type === 'text') paste(data.text); }}
        acceptedContentTypes={['plain-text']}
        displayMode="labelOnly"
        cornerStyle="capsule"
        backgroundColor="#2A2A2E"
        foregroundColor="#FFFFFF"
        style={styles.pasteNative}
      />
    );
  } else {
    right = (
      <Pressable
        onPress={async () => {
          try { paste(await Clipboard.getStringAsync()); } catch {}
        }}
        accessibilityRole="button"
        accessibilityLabel={pasteLabel}
        style={styles.pasteChip}
      >
        <Text weight="semibold" color={AUTH.text} style={styles.pasteText}>
          {pasteLabel}
        </Text>
      </Pressable>
    );
  }
  return (
    <TextField
      ref={ref}
      value={formatKey(value)}
      onChangeText={(text) => onChange(normaliseKey(text))}
      placeholder="XXX-XXX-XXX-XXX"
      autoCapitalize="characters"
      autoCorrect={false}
      autoComplete="off"
      spellCheck={false}
      textContentType="none"
      returnKeyType="next"
      onSubmitEditing={onSubmit}
      inputStyle={styles.keyInput}
      right={right}
    />
  );
});

// ─── PIN ─────────────────────────────────────────────────────────────────────

export type PinFieldHandle = { focus: () => void; shake: () => void };

function PinBox({ filled, active, error }: { filled: boolean; active: boolean; error?: boolean }) {
  const dot = useRef(new Animated.Value(filled ? 1 : 0)).current;
  useEffect(() => {
    Animated.spring(dot, { toValue: filled ? 1 : 0, speed: 40, bounciness: filled ? 10 : 0, useNativeDriver: true }).start();
  }, [dot, filled]);
  return (
    <View style={[styles.pinBox, filled && styles.pinBoxFilled, active && styles.pinBoxActive, error && styles.pinBoxError]}>
      <Animated.View style={[styles.pinDot, { opacity: dot, transform: [{ scale: dot }] }]} />
    </View>
  );
}

/**
 * Four boxes over a hidden number field. `onComplete` fires once, when the fourth digit is typed.
 */
export const PinField = forwardRef<PinFieldHandle, {
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  disabled?: boolean;
  error?: boolean;
}>(function PinField({ value, onChange, onComplete, disabled, error }, ref) {
  const input = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);
  const shakeX = useRef(new Animated.Value(0)).current;
  useImperativeHandle(ref, () => ({
    focus: () => input.current?.focus(),
    shake: () => {
      const to = (x: number, duration: number) =>
        Animated.timing(shakeX, { toValue: x, duration, useNativeDriver: true });
      Animated.sequence([to(-10, 45), to(10, 70), to(-7, 65), to(6, 60), to(0, 55)]).start();
    },
  }), [shakeX]);

  return (
    <View>
      <Pressable onPress={() => input.current?.focus()} accessibilityRole="button" accessibilityLabel={`PIN, ${value.length} / 4`}>
        <Animated.View style={[styles.pinRow, { transform: [{ translateX: shakeX }] }, disabled && styles.pinRowBusy]}>
          {[0, 1, 2, 3].map((i) => (
            <PinBox key={i} filled={i < value.length} active={focused && i === value.length} error={error} />
          ))}
        </Animated.View>
      </Pressable>
      <TextInput
        ref={input}
        value={value}
        editable={!disabled}
        onChangeText={(text) => {
          const next = text.replace(/[^0-9]/g, '').slice(0, 4);
          if (next.length > value.length) triggerHaptic('selection');
          onChange(next);
          if (next.length === 4 && value.length < 4) onComplete?.(next);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        keyboardType="number-pad"
        keyboardAppearance="dark"
        maxLength={4}
        autoComplete="off"
        textContentType="none"
        caretHidden
        style={styles.pinInput}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  pill: {
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  pillFilled: { backgroundColor: '#FFFFFF' },
  pillFilledOff: { backgroundColor: 'rgba(255,255,255,0.14)' },
  pillOutline: { borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.28)' },
  pillOutlineOff: { borderColor: 'rgba(255,255,255,0.12)' },
  pillLabel: { fontSize: 17, lineHeight: 22 },
  header: { marginBottom: 22 },
  title: { fontSize: 27, lineHeight: 33, letterSpacing: -0.3 },
  subtitle: { fontSize: 15, lineHeight: 21, marginTop: 6 },
  field: {
    height: 56,
    borderRadius: 18,
    backgroundColor: AUTH.field,
    borderWidth: 1,
    borderColor: AUTH.fieldBorder,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  fieldFocused: { borderColor: AUTH.fieldFocus },
  prefix: { fontSize: 17, marginRight: 1 },
  input: {
    flex: 1,
    height: '100%',
    fontSize: 17,
    color: AUTH.text,
    paddingVertical: 0,
  },
  // 15 characters with the dashes, beside the paste button, on a 360 pt wide phone.
  keyInput: { fontFamily: KEY_FONT, fontSize: 17, letterSpacing: 1 },
  clear: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  pasteNative: { width: 104, height: 34, marginLeft: 8 },
  pasteChip: {
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  pasteText: { fontSize: 14 },
  pinRow: { flexDirection: 'row', justifyContent: 'center', gap: 12 },
  pinRowBusy: { opacity: 0.45 },
  pinBox: {
    width: 60,
    height: 66,
    borderRadius: 18,
    backgroundColor: AUTH.field,
    borderWidth: 1.5,
    borderColor: AUTH.fieldBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinBoxFilled: { borderColor: 'rgba(255,255,255,0.30)' },
  pinBoxActive: { borderColor: 'rgba(255,255,255,0.85)' },
  pinBoxError: { borderColor: 'rgba(255,107,107,0.85)' },
  pinDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#FFFFFF' },
  pinInput: { position: 'absolute', width: 1, height: 1, opacity: 0 },
});
