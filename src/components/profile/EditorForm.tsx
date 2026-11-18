/**
 * Building blocks of the profile editor's form, in the inset-grouped style of the settings screens
 * (`SettingsSection`): rounded cards on the screen background, rows separated by hairlines, a small
 * caption above each value, explanations under the card.
 *
 * Replaces the bordered `Input` boxes the editor used to stack one per field. Those were asked to go
 * ("выглядит очень по-старому"): a 1.5 pt outline around every field, each in its own box, is the
 * form style of a decade ago. A field here has no outline at all; the card is the container, and
 * focus is shown by the caption taking the accent colour.
 */
import React, { memo, useCallback, useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text as RNText,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { Feather, FontAwesome5 } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { Text } from '../ui/Text';
import { detectLinkKind, linkDisplayName, linkKindInfo, linkShortText } from '../../utils/linkKind';

/** Hairline between rows of one card, inset from the leading edge like iOS lists. */
export function EditorHairline({ inset = 16 }: { inset?: number }) {
  const theme = useTheme();
  return (
    <View
      style={{
        height: StyleSheet.hairlineWidth,
        marginLeft: inset,
        // Translucent rather than `border.light`: in the dark palette that token is the same colour
        // as the elevated card, so the line would vanish.
        backgroundColor: theme.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.09)',
      }}
    />
  );
}

/** Section caption above a card, with an optional value on the right ("1/3"). */
export function EditorSectionHeader({ title, right }: { title: string; right?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.sectionHeader}>
      <Text variant="caption" weight="semibold" color={theme.colors.text.tertiary} style={styles.sectionHeaderText}>
        {title.toUpperCase()}
      </Text>
      {right ? (
        <Text variant="caption" color={theme.colors.text.tertiary} style={styles.sectionHeaderText}>
          {right}
        </Text>
      ) : null}
    </View>
  );
}

interface EditorFieldProps {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  /** Fixed text in front of the value that is not part of it, e.g. `@` before a username. */
  prefix?: string;
  multiline?: boolean;
  maxLength?: number;
  /** Show how many characters are left, under the value on the right. */
  showCounter?: boolean;
  autoCapitalize?: TextInputProps['autoCapitalize'];
  autoCorrect?: boolean;
  keyboardType?: TextInputProps['keyboardType'];
  returnKeyType?: TextInputProps['returnKeyType'];
  /** A short message under the value, in the error colour. */
  error?: string | null;
}

/**
 * One editable value: caption on top, the text under it. The whole row is the tap target, so a tap on
 * the caption or the padding focuses the field instead of doing nothing.
 */
export const EditorField = memo(function EditorField({
  label,
  value,
  onChangeText,
  placeholder,
  prefix,
  multiline = false,
  maxLength,
  showCounter = false,
  autoCapitalize,
  autoCorrect,
  keyboardType,
  returnKeyType,
  error,
}: EditorFieldProps) {
  const theme = useTheme();
  const inputRef = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);
  const focus = useCallback(() => inputRef.current?.focus(), []);
  const onFocus = useCallback(() => setFocused(true), []);
  const onBlur = useCallback(() => setFocused(false), []);

  const left = maxLength != null ? maxLength - value.length : null;
  const textColor = theme.colors.text.primary;
  const fontSize = 16 * theme.fontScale;
  const lineHeight = Math.round(fontSize * 1.32);

  return (
    <Pressable onPress={focus} style={styles.field} accessible={false}>
      <Text
        variant="caption"
        weight="medium"
        color={error ? theme.colors.status.error : focused ? theme.colors.accent.primary : theme.colors.text.tertiary}
        style={styles.fieldLabel}
      >
        {label}
      </Text>
      <View style={styles.fieldValueRow}>
        {prefix ? (
          <RNText
            allowFontScaling={false}
            style={{ color: theme.colors.text.tertiary, fontFamily: theme.fontFamily.regular, fontSize, lineHeight, marginRight: 1 }}
          >
            {prefix}
          </RNText>
        ) : null}
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={theme.colors.text.tertiary}
          multiline={multiline}
          maxLength={maxLength}
          autoCapitalize={autoCapitalize}
          autoCorrect={autoCorrect}
          keyboardType={keyboardType}
          returnKeyType={returnKeyType}
          onFocus={onFocus}
          onBlur={onBlur}
          selectionColor={theme.colors.accent.primary}
          // A label already says what this is; VoiceOver should read it as the field's name.
          accessibilityLabel={label}
          style={[
            styles.fieldInput,
            {
              color: textColor,
              fontFamily: theme.fontFamily.regular,
              fontSize,
              // iOS clips descenders of a single-line TextInput that is given a lineHeight, so only the
              // multiline field gets one.
              lineHeight: multiline ? lineHeight : undefined,
              minHeight: multiline ? lineHeight * 2 : lineHeight + 2,
              maxHeight: multiline ? lineHeight * 6 : undefined,
              textAlignVertical: multiline ? 'top' : 'center',
            },
          ]}
        />
      </View>
      {error || (showCounter && left != null) ? (
        <View style={styles.fieldFooter}>
          <Text variant="caption" color={theme.colors.status.error} style={styles.fieldFooterText} numberOfLines={2}>
            {error || ''}
          </Text>
          {showCounter && left != null ? (
            <Text
              variant="caption"
              color={left <= 10 ? theme.colors.status.error : theme.colors.text.tertiary}
              style={styles.fieldCounter}
            >
              {String(left)}
            </Text>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
});

/** The coloured square with a service's glyph, shared by the link rows and the link sheet. */
export const LinkKindTile = memo(function LinkKindTile({ url, size = 32 }: { url: string; size?: number }) {
  const info = linkKindInfo(detectLinkKind(url));
  const glyph = Math.round(size * (info.brand ? 0.52 : 0.44));
  return (
    <View style={[styles.tile, { width: size, height: size, borderRadius: Math.round(size * 0.3), backgroundColor: info.color }]}>
      {info.brand ? (
        <FontAwesome5 name={info.icon} size={glyph} color={info.on} brand />
      ) : (
        <FontAwesome5 name={info.icon} size={glyph} color={info.on} solid />
      )}
    </View>
  );
});

/** One saved link: the service, the address under it, and a remove button. Tap to edit. */
export const EditorLinkRow = memo(function EditorLinkRow({
  url,
  index,
  onEdit,
  onRemove,
  removeLabel,
}: {
  url: string;
  index: number;
  onEdit: (index: number) => void;
  onRemove: (index: number) => void;
  removeLabel: string;
}) {
  const theme = useTheme();
  const pressedBg = theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)';
  return (
    <Pressable
      onPress={() => onEdit(index)}
      style={({ pressed }) => [styles.linkRow, pressed ? { backgroundColor: pressedBg } : null]}
    >
      <LinkKindTile url={url} />
      <View style={styles.linkText}>
        <Text variant="body" weight="medium" numberOfLines={1}>
          {linkDisplayName(url)}
        </Text>
        <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1}>
          {linkShortText(url)}
        </Text>
      </View>
      <Pressable
        onPress={() => onRemove(index)}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={removeLabel}
        style={[styles.removeBtn, { backgroundColor: theme.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)' }]}
      >
        <Feather name="x" size={14} color={theme.colors.text.secondary} />
      </Pressable>
    </Pressable>
  );
});

/** "Add a link": the same row shape as a saved link, in the accent colour. */
export function EditorAddLinkRow({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  const accent = theme.colors.accent.primary;
  const pressedBg = theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)';
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.linkRow, pressed ? { backgroundColor: pressedBg } : null]}>
      <View style={[styles.tile, { width: 32, height: 32, borderRadius: 10, backgroundColor: accent + '22' }]}>
        <Feather name="plus" size={18} color={accent} />
      </View>
      <Text variant="body" weight="medium" color={accent} style={styles.linkText}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  sectionHeaderText: { fontSize: 12, letterSpacing: 0.4 },
  field: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 11 },
  fieldLabel: { fontSize: 12.5, marginBottom: 2 },
  fieldValueRow: { flexDirection: 'row', alignItems: 'flex-start' },
  fieldInput: { flex: 1, padding: 0, margin: 0 },
  fieldFooter: { flexDirection: 'row', alignItems: 'flex-end', marginTop: 4 },
  fieldFooterText: { flex: 1, fontSize: 12 },
  fieldCounter: { fontSize: 12, marginLeft: 8 },
  tile: { alignItems: 'center', justifyContent: 'center' },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    minHeight: 58,
  },
  linkText: { flex: 1, minWidth: 0 },
  removeBtn: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
