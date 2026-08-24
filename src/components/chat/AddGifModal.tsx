import React, { useCallback, useState } from 'react';
import { View, Modal, Pressable, TextInput, ActivityIndicator, Text as RNText, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { validateGifLink, useCustomGifs } from '../../store/customGifsStore';
import { triggerHaptic } from '../../utils/haptics';
import { showToast } from '../../store/toastStore';

export interface AddGifModalProps {
  visible: boolean;
  onClose: () => void;
  theme: any;
  labels: {
    title: string;
    hint: string;
    placeholder: string;
    paste: string;
    add: string;
    cancel: string;
    errNotHttps: string;
    errNotMedia: string;
    added: string;
  };
}

/**
 * Paste a link, get a GIF in your own row of the picker.
 *
 * ── WHY A LINK AND NOT A FILE PICKER ────────────────────────────────────────
 *
 * A file picker would mean uploading and hosting the user's media, which is storage and egress we do not
 * need to spend for something the source already hosts — and the request was specifically "you just
 * paste a link". The link is kept as-is and rendered from its origin.
 *
 * ── WHY IT ASKS FOR A DIRECT LINK ───────────────────────────────────────────
 *
 * Turning an Instagram or Telegram POST page into its underlying media needs their private API or HTML
 * scraping. That is against their terms, and under the Apple Developer Program License Agreement
 * §3.3.4.A.i it makes the media we then display an infringement of third-party rights. This repo already
 * carries that judgement once, about SoundCloud, recorded as a submission risk to remove rather than
 * repeat. So the validation is honest about what it needs, and the error message says exactly what to do
 * instead — copy the image's own address, which every browser and Telegram offer directly.
 *
 * Direct links from all of those services work today. It is only the page URL that cannot be unwrapped.
 */
export function AddGifModal({ visible, onClose, theme, labels }: AddGifModalProps) {
  const [url, setUrl] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const add = useCustomGifs((s) => s.add);

  const close = useCallback(() => {
    setUrl('');
    setError(null);
    setChecking(false);
    onClose();
  }, [onClose]);

  const pasteFromClipboard = useCallback(async () => {
    triggerHaptic('light');
    try {
      const text = await Clipboard.getStringAsync();
      if (text) { setUrl(text.trim()); setError(null); }
    } catch {}
  }, []);

  const submit = useCallback(async () => {
    if (checking) return;
    setChecking(true);
    setError(null);
    // `validateGifLink` may do one HEAD request, so this is awaited rather than optimistic. An entry that
    // cannot load is worse than a rejection: it lands in the grid looking permanent, and the user has no
    // way to tell a broken link from a slow one.
    const res = await validateGifLink(url);
    setChecking(false);
    if (!res.ok) {
      if (res.reason === 'not_https') setError(labels.errNotHttps);
      else if (res.reason === 'not_media') setError(labels.errNotMedia);
      return;
    }
    add(res.url);
    triggerHaptic('medium');
    showToast(labels.added, 'check');
    close();
  }, [checking, url, add, labels, close]);

  const canSubmit = url.trim().length > 0 && !checking;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close} statusBarTranslucent>
      <View style={styles.root}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} />
        <View style={[styles.card, { backgroundColor: theme.colors.background.elevated }]}>
          <View style={styles.header}>
            <Feather name="plus-circle" size={17} color={theme.colors.accent.primary} />
            <RNText style={[styles.title, { color: theme.colors.text.primary }]}>{labels.title}</RNText>
          </View>

          <RNText style={[styles.hint, { color: theme.colors.text.tertiary }]}>{labels.hint}</RNText>

          <View style={[styles.inputRow, { borderColor: error ? '#FF3B30' : theme.colors.border.light }]}>
            <TextInput
              value={url}
              onChangeText={(v) => { setUrl(v); setError(null); }}
              placeholder={labels.placeholder}
              placeholderTextColor={theme.colors.text.tertiary}
              style={[styles.input, { color: theme.colors.text.primary }]}
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              keyboardType="url"
              // A pasted URL is long and the field is one line, so keep the tail visible — that is the
              // part that says whether it is the image or the page.
              numberOfLines={1}
              onSubmitEditing={submit}
              returnKeyType="done"
            />
            <Pressable onPress={pasteFromClipboard} hitSlop={8} style={styles.pasteBtn}>
              <Feather name="clipboard" size={15} color={theme.colors.text.secondary} />
            </Pressable>
          </View>

          {error ? <RNText style={styles.error}>{error}</RNText> : null}

          <View style={styles.actions}>
            <Pressable onPress={close} style={[styles.btn, styles.btnFlat, { borderColor: theme.colors.border.light }]}>
              <RNText style={{ color: theme.colors.text.secondary, fontSize: 14, fontWeight: '600' }}>{labels.cancel}</RNText>
            </Pressable>
            <Pressable
              onPress={submit}
              disabled={!canSubmit}
              style={[styles.btn, { backgroundColor: canSubmit ? theme.colors.accent.primary : theme.colors.background.tertiary, opacity: canSubmit ? 1 : 0.6 }]}
            >
              {checking ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <RNText style={{ color: canSubmit ? '#FFFFFF' : theme.colors.text.tertiary, fontSize: 14, fontWeight: '700' }}>{labels.add}</RNText>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  card: { width: '100%', maxWidth: 420, borderRadius: 22, padding: 18, shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.25, shadowRadius: 18, elevation: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 16, fontWeight: '700' },
  hint: { fontSize: 12, lineHeight: 17, marginTop: 8 },
  inputRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 12, paddingLeft: 12, paddingRight: 6, marginTop: 12, height: 44 },
  input: { flex: 1, fontSize: 14, paddingVertical: 0 },
  pasteBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  error: { color: '#FF3B30', fontSize: 12, lineHeight: 17, marginTop: 8 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  btn: { flex: 1, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  btnFlat: { borderWidth: 1 },
});
