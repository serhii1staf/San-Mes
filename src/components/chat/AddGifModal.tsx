import React, { useCallback, useState } from 'react';
import { View, Modal, Pressable, TextInput, ActivityIndicator, ScrollView, Text as RNText, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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
    sourcesTitle: string;
    sourcesBody: string;
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
    // ── A FULL SCREEN, NOT A DIALOG ────────────────────────────────────────────
    //
    // Asked for: "when I press Add GIF a proper full window should open."
    //
    // It is also the right shape for what this does. The dialog had to fit a paste field, an explanation
    // of which links work, and an error that is two sentences long — inside a card floating over a
    // half-open keyboard panel. Something was always going to be cramped or clipped. Full screen gives
    // the explanation room to be read instead of skimmed, which matters here because the explanation is
    // the difference between the user pasting the right thing and pasting a page again.
    //
    // `slide` rather than `fade`: this comes from a button at the bottom of the panel, so it should
    // arrive from that direction.
    <Modal visible={visible} animationType="slide" onRequestClose={close} presentationStyle="fullScreen">
      <View style={[styles.root, { backgroundColor: theme.colors.background.primary }]}>
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <View style={styles.headerRow}>
            <RNText style={[styles.title, { color: theme.colors.text.primary }]}>{labels.title}</RNText>
            {/* Close lives in the header, because a full screen has no backdrop to tap. */}
            <Pressable onPress={close} hitSlop={10} accessibilityRole="button" style={styles.closeBtn}>
              <Feather name="x" size={22} color={theme.colors.text.secondary} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
          >
          <RNText style={[styles.hint, { color: theme.colors.text.secondary }]}>{labels.hint}</RNText>

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

          {/* Which links resolve, spelled out. The Discord case was reported as a bug precisely because
              the app looked like it could not do something Discord does — it could, it just was not
              resolving the page. Saying so here is cheaper than the user guessing. */}
          <View style={[styles.sources, { borderColor: theme.colors.border.light }]}>
            <RNText style={[styles.sourcesTitle, { color: theme.colors.text.primary }]}>{labels.sourcesTitle}</RNText>
            <RNText style={[styles.sourcesBody, { color: theme.colors.text.tertiary }]}>{labels.sourcesBody}</RNText>
          </View>
          </ScrollView>

          <View style={styles.actions}>
            <Pressable onPress={close} style={[styles.btn, styles.btnFlat, { borderColor: theme.colors.border.light }]}>
              <RNText style={{ color: theme.colors.text.secondary, fontSize: 15, fontWeight: '600' }}>{labels.cancel}</RNText>
            </Pressable>
            <Pressable
              onPress={submit}
              disabled={!canSubmit}
              style={[styles.btn, { backgroundColor: canSubmit ? theme.colors.accent.primary : theme.colors.background.tertiary, opacity: canSubmit ? 1 : 0.6 }]}
            >
              {checking ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <RNText style={{ color: canSubmit ? '#FFFFFF' : theme.colors.text.tertiary, fontSize: 15, fontWeight: '700' }}>{labels.add}</RNText>
              )}
            </Pressable>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  headerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
  title: { fontSize: 22, fontWeight: '700', flex: 1 },
  closeBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1 },
  bodyContent: { paddingHorizontal: 20, paddingBottom: 24 },
  hint: { fontSize: 14, lineHeight: 21 },
  inputRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 14, paddingLeft: 14, paddingRight: 6, marginTop: 18, height: 52 },
  input: { flex: 1, fontSize: 15, paddingVertical: 0 },
  pasteBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  error: { color: '#FF3B30', fontSize: 13, lineHeight: 19, marginTop: 10 },
  sources: { borderWidth: 1, borderRadius: 14, padding: 14, marginTop: 22 },
  sourcesTitle: { fontSize: 13, fontWeight: '700', marginBottom: 6 },
  sourcesBody: { fontSize: 12, lineHeight: 19 },
  // Pinned below the scroll area so the two buttons never scroll out of reach on a small screen.
  actions: { flexDirection: 'row', gap: 12, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  btn: { flex: 1, height: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  btnFlat: { borderWidth: 1 },
});
