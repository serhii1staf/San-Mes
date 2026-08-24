import React, { useCallback, useState } from 'react';
import { View, Modal, Pressable, TextInput, ActivityIndicator, ScrollView, Text as RNText, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { validateGifLink, useCustomGifs } from '../../store/customGifsStore';
import { importTelegramPack, isTelegramPackLink } from '../../services/telegramStickers';
import { CachedImage } from '../ui/CachedImage';
import { triggerHaptic } from '../../utils/haptics';
import { showToast } from '../../store/toastStore';

export interface AddGifLabelSet {
  title: string;
  hint: string;
  placeholder: string;
  paste: string;
  add: string;
  find: string;
  cancel: string;
  errNotHttps: string;
  errNotMedia: string;
  errPackNotFound: string;
  errPackNotConfigured: string;
  added: string;
  foundOne: string;
  foundPack: string;
  animatedNote: string;
}

export interface AddGifModalProps {
  visible: boolean;
  onClose: () => void;
  theme: any;
  labels: AddGifLabelSet;
}

/** What a resolved link turned out to be, ready to commit. */
interface Resolved {
  urls: string[];
  /** Pack title, when a whole set was imported. */
  title?: string;
  /** A pack whose real format we cannot animate — imported as static thumbnails. */
  animated?: boolean;
}

/** How many of a pack's stickers the in-window preview shows before it stops adding rows. */
const PREVIEW_CAP = 12;

/**
 * Add a GIF, or a whole sticker pack, by pasting a link.
 *
 * ── THIS WAS A FULL SCREEN AND SHOULD NOT HAVE BEEN ─────────────────────────
 *
 * The previous version took over the display, which was wrong for a two-field action reached from a
 * button inside a keyboard-height panel. It is a compact centred sheet again, matching the other pickers
 * in the app.
 *
 * The reason it grew was the explanation of which links work — genuinely useful, because "Copy Link" from
 * Discord gives a page and not a file, and knowing that is the difference between success and confusion.
 * The fix for "useful but long" is not a bigger window, it is a window that only shows it when asked: the
 * `⋯` button toggles it, and it starts closed, so the sheet is small by default and complete on demand.
 *
 * ── AND IT NOW SHOWS WHAT IT FOUND, BEFORE COMMITTING ───────────────────────
 *
 * Reported: pasting a sticker-pack link produced the Telegram LOGO. Two faults in one symptom. The
 * resolution was wrong (a pack link resolves through the Bot API, not through Open Graph — see
 * `telegramStickers.ts`), and there was no confirmation step, so a wrong answer went straight into the
 * grid where the user had to hunt it down to remove it.
 *
 * Resolving is now separate from adding. Paste, and the sheet fetches and displays the stickers it found,
 * in the sheet; the button then commits them. A wrong answer is visible before it costs anything.
 */
export function AddGifModal({ visible, onClose, theme, labels }: AddGifModalProps) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [showHint, setShowHint] = useState(false);
  const add = useCustomGifs((s) => s.add);
  const addMany = useCustomGifs((s) => s.addMany);

  const reset = useCallback(() => {
    setUrl('');
    setError(null);
    setResolved(null);
    setBusy(false);
    setShowHint(false);
  }, []);

  const close = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  /** Resolve a link into one GIF or a pack. Never commits. */
  const resolve = useCallback(
    async (candidate: string) => {
      const target = (candidate || '').trim();
      if (!target || busy) return;
      setBusy(true);
      setError(null);
      setResolved(null);

      // A pack link is checked first and by shape, so a whole set never goes down the single-image path
      // and comes back as the pack's cover art — which is exactly the reported bug.
      if (isTelegramPackLink(target)) {
        const res = await importTelegramPack(target);
        setBusy(false);
        if (!res.ok) {
          setError(
            res.reason === 'not_configured'
              ? labels.errPackNotConfigured
              : labels.errPackNotFound,
          );
          return;
        }
        setResolved({ urls: res.pack.urls, title: res.pack.title, animated: res.pack.animated });
        return;
      }

      const single = await validateGifLink(target);
      setBusy(false);
      if (!single.ok) {
        setError(single.reason === 'not_https' ? labels.errNotHttps : labels.errNotMedia);
        return;
      }
      setResolved({ urls: [single.url] });
    },
    [busy, labels],
  );

  /** Paste and resolve in one action — pasting a link IS the request to look it up. */
  const pasteAndResolve = useCallback(async () => {
    triggerHaptic('light');
    try {
      const text = (await Clipboard.getStringAsync())?.trim();
      if (!text) return;
      setUrl(text);
      await resolve(text);
    } catch {}
  }, [resolve]);

  const commit = useCallback(() => {
    if (!resolved || resolved.urls.length === 0) return;
    if (resolved.urls.length === 1) add(resolved.urls[0]);
    else addMany(resolved.urls);
    triggerHaptic('medium');
    showToast(labels.added, 'check');
    close();
  }, [resolved, add, addMany, labels.added, close]);

  const hasText = url.trim().length > 0;
  const primaryLabel = resolved ? labels.add : labels.find;
  const primaryEnabled = !busy && (resolved ? true : hasText);
  const onPrimary = resolved ? commit : () => void resolve(url);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close} statusBarTranslucent>
      <View style={styles.root}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} />

        <View style={[styles.card, { backgroundColor: theme.colors.background.elevated }]}>
          <View style={styles.header}>
            <RNText style={[styles.title, { color: theme.colors.text.primary }]}>{labels.title}</RNText>
            {/* The instructions live behind this. Closed by default so the sheet stays small; one tap
                away so the Discord-link explanation is never more than that. */}
            <Pressable
              onPress={() => { triggerHaptic('light'); setShowHint((v) => !v); }}
              hitSlop={10}
              accessibilityRole="button"
              style={styles.iconBtn}
            >
              <Feather name={showHint ? 'chevron-up' : 'more-horizontal'} size={19} color={theme.colors.text.secondary} />
            </Pressable>
          </View>

          {showHint ? (
            <RNText style={[styles.hint, { color: theme.colors.text.tertiary }]}>{labels.hint}</RNText>
          ) : null}

          <View style={[styles.inputRow, { borderColor: error ? '#FF3B30' : theme.colors.border.light }]}>
            <TextInput
              value={url}
              onChangeText={(v) => { setUrl(v); setError(null); setResolved(null); }}
              placeholder={labels.placeholder}
              placeholderTextColor={theme.colors.text.tertiary}
              style={[styles.input, { color: theme.colors.text.primary }]}
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              keyboardType="url"
              returnKeyType="go"
              onSubmitEditing={() => void resolve(url)}
            />
            <Pressable onPress={pasteAndResolve} hitSlop={8} style={styles.pasteBtn} accessibilityLabel={labels.paste}>
              <Feather name="clipboard" size={16} color={theme.colors.text.secondary} />
            </Pressable>
          </View>

          {error ? <RNText style={styles.error}>{error}</RNText> : null}

          {busy ? (
            <View style={styles.busy}>
              <ActivityIndicator color={theme.colors.accent.primary} />
            </View>
          ) : null}

          {/* WHAT WAS FOUND, IN THE SHEET. The confirmation step the previous version did not have. */}
          {resolved ? (
            <View style={styles.found}>
              <RNText style={[styles.foundLine, { color: theme.colors.text.secondary }]}>
                {resolved.urls.length > 1
                  ? labels.foundPack.replace('{n}', String(resolved.urls.length)).replace('{title}', resolved.title || '')
                  : labels.foundOne}
              </RNText>
              {resolved.animated ? (
                <RNText style={[styles.animatedNote, { color: theme.colors.text.tertiary }]}>{labels.animatedNote}</RNText>
              ) : null}
              <ScrollView
                horizontal={resolved.urls.length > 1}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={resolved.urls.length > 1 ? styles.previewRow : styles.previewSingle}
              >
                {resolved.urls.slice(0, PREVIEW_CAP).map((u) => (
                  <View
                    key={u}
                    style={[
                      resolved.urls.length > 1 ? styles.previewCell : styles.previewBig,
                      { backgroundColor: theme.colors.background.secondary },
                    ]}
                  >
                    {/* `noProxy`: these are already small (a sticker or a picker-sized GIF) and routing
                        them through the resize proxy would add a hop and a re-encode for nothing —
                        the same reasoning the GIF grid's cells carry. */}
                    <CachedImage uri={u} style={StyleSheet.absoluteFill} resizeMode="contain" noProxy />
                  </View>
                ))}
              </ScrollView>
            </View>
          ) : null}

          <View style={styles.actions}>
            <Pressable onPress={close} style={[styles.btn, styles.btnFlat, { borderColor: theme.colors.border.light }]}>
              <RNText style={{ color: theme.colors.text.secondary, fontSize: 14, fontWeight: '600' }}>{labels.cancel}</RNText>
            </Pressable>
            <Pressable
              onPress={onPrimary}
              disabled={!primaryEnabled}
              style={[
                styles.btn,
                {
                  backgroundColor: primaryEnabled ? theme.colors.accent.primary : theme.colors.background.tertiary,
                  opacity: primaryEnabled ? 1 : 0.6,
                },
              ]}
            >
              <RNText style={{ color: primaryEnabled ? '#FFFFFF' : theme.colors.text.tertiary, fontSize: 14, fontWeight: '700' }}>
                {primaryLabel}
              </RNText>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22 },
  card: { width: '100%', maxWidth: 400, borderRadius: 22, padding: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.25, shadowRadius: 18, elevation: 12 },
  header: { flexDirection: 'row', alignItems: 'center' },
  title: { fontSize: 17, fontWeight: '700', flex: 1 },
  iconBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  hint: { fontSize: 12, lineHeight: 18, marginTop: 6 },
  inputRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 12, paddingLeft: 12, paddingRight: 4, marginTop: 12, height: 46 },
  input: { flex: 1, fontSize: 14, paddingVertical: 0 },
  pasteBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  error: { color: '#FF3B30', fontSize: 12, lineHeight: 18, marginTop: 8 },
  busy: { paddingVertical: 16, alignItems: 'center' },
  found: { marginTop: 12 },
  foundLine: { fontSize: 12, fontWeight: '600' },
  animatedNote: { fontSize: 11, lineHeight: 16, marginTop: 3 },
  previewRow: { gap: 6, paddingTop: 8, paddingRight: 4 },
  previewSingle: { paddingTop: 8 },
  previewCell: { width: 56, height: 56, borderRadius: 10, overflow: 'hidden' },
  previewBig: { width: 120, height: 120, borderRadius: 12, overflow: 'hidden' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  btn: { flex: 1, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  btnFlat: { borderWidth: 1 },
});
