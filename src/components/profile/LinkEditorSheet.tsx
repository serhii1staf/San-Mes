/**
 * Add or edit one profile link.
 *
 * No type picker. It used to open on a grid of eleven service pills ("Тип") above the URL field, and
 * the type was guessed from the URL only to pre-select a pill. Asked for: no categories, just paste
 * the link and have it recognised. So the sheet is one field, and under it a live preview of what the
 * link was recognised as — the service's tile and name, or the site's domain — which is also exactly
 * what the profile will show.
 *
 * Recognition is `detectLinkKind` (by host, see src/utils/linkKind.ts), and what is stored is the
 * normalised link: `https://` added when it was typed without one, an email address turned into
 * `mailto:`. Anything that is not an http(s) or mailto link cannot be saved.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { Text } from '../ui/Text';
import { SlideUpSheet } from '../ui/SlideUpSheet';
import { useT } from '../../i18n/store';
import { detectLinkKind, linkDisplayName, linkShortText, normalizeLinkUrl, type LinkKind } from '../../utils/linkKind';
import { LinkKindTile } from './EditorForm';

/** After the sheet's 300 ms rise, so the keyboard does not come up through the animation. */
const FOCUS_DELAY_MS = 320;

export function LinkEditorSheet({
  visible,
  initialUrl,
  isEdit,
  onClose,
  onSave,
  onRemove,
}: {
  visible: boolean;
  initialUrl: string;
  isEdit: boolean;
  onClose: () => void;
  onSave: (link: { type: LinkKind; url: string }) => void;
  onRemove?: () => void;
}) {
  const theme = useTheme();
  const t = useT();
  const inputRef = useRef<TextInput>(null);
  const [text, setText] = useState(initialUrl);

  useEffect(() => {
    if (!visible) return;
    setText(initialUrl);
    const id = setTimeout(() => inputRef.current?.focus(), FOCUS_DELAY_MS);
    return () => clearTimeout(id);
  }, [visible, initialUrl]);

  const normalized = useMemo(() => normalizeLinkUrl(text), [text]);
  const kind = useMemo(() => (normalized ? detectLinkKind(normalized) : null), [normalized]);

  const accent = theme.colors.accent.primary;
  const fieldBg = theme.isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.045)';
  const canSave = !!normalized;

  const save = () => {
    if (!normalized || !kind) return;
    onSave({ type: kind, url: normalized });
  };

  return (
    <SlideUpSheet visible={visible} onClose={onClose}>
      <View style={styles.body}>
        <Text variant="body" weight="semibold" align="center" style={styles.title}>
          {isEdit ? t('edit_profile.link_edit_title') : t('edit_profile.link_add_title')}
        </Text>

        <View style={[styles.field, { backgroundColor: fieldBg }]}>
          <Feather name="link" size={17} color={theme.colors.text.tertiary} />
          <TextInput
            ref={inputRef}
            value={text}
            onChangeText={setText}
            placeholder="https://"
            placeholderTextColor={theme.colors.text.tertiary}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            keyboardType="url"
            textContentType="URL"
            returnKeyType="done"
            onSubmitEditing={save}
            selectionColor={accent}
            style={[styles.input, { color: theme.colors.text.primary, fontFamily: theme.fontFamily.regular }]}
          />
          {text.length > 0 ? (
            <Pressable onPress={() => setText('')} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('common.delete')}>
              <Feather name="x-circle" size={17} color={theme.colors.text.tertiary} />
            </Pressable>
          ) : null}
        </View>

        {/* What the link was recognised as. The space is reserved either way, so the button below
            does not jump the moment a link becomes valid. */}
        <View style={styles.previewSlot}>
          {normalized && kind ? (
            <View style={styles.preview}>
              <LinkKindTile url={normalized} size={40} />
              <View style={styles.previewText}>
                <Text variant="body" weight="semibold" numberOfLines={1}>
                  {linkDisplayName(normalized, kind)}
                </Text>
                <Text variant="caption" color={theme.colors.text.tertiary} numberOfLines={1}>
                  {linkShortText(normalized)}
                </Text>
              </View>
              <Feather name="check-circle" size={18} color={theme.colors.status.success} />
            </View>
          ) : (
            <Text variant="caption" color={theme.colors.text.tertiary} align="center" style={styles.hint}>
              {t('edit_profile.link_hint')}
            </Text>
          )}
        </View>

        <Pressable
          onPress={save}
          disabled={!canSave}
          style={({ pressed }) => [
            styles.primary,
            { backgroundColor: accent, opacity: !canSave ? 0.4 : pressed ? 0.85 : 1 },
          ]}
        >
          <Text variant="body" weight="semibold" color="#FFFFFF">
            {isEdit ? t('edit_profile.link_save') : t('edit_profile.link_add')}
          </Text>
        </Pressable>

        {isEdit && onRemove ? (
          <Pressable onPress={onRemove} hitSlop={6} style={styles.remove}>
            <Text variant="body" weight="medium" color={theme.colors.status.error}>
              {t('edit_profile.link_remove')}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </SlideUpSheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 2 },
  title: { marginBottom: 14 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 50,
    borderRadius: 16,
    paddingHorizontal: 14,
  },
  input: { flex: 1, fontSize: 16, padding: 0 },
  previewSlot: { minHeight: 72, justifyContent: 'center', paddingVertical: 10 },
  preview: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 4 },
  previewText: { flex: 1, minWidth: 0 },
  hint: { paddingHorizontal: 12, lineHeight: 18 },
  primary: { height: 50, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  remove: { alignItems: 'center', paddingVertical: 14 },
});
