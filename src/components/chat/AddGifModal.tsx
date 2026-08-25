import React, { useCallback, useRef, useState } from 'react';
import { View, Pressable, TextInput, ActivityIndicator, ScrollView, Text as RNText, StyleSheet } from 'react-native';
import { SlideUpSheet } from '../ui/SlideUpSheet';
import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
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
  errTgMessage: string;
  errPackNotFound: string;
  errPackEmpty: string;
  errPackAuth: string;
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
  /** Pack SHORT name - the one that rebuilds a t.me link, for the "view pack" action later. */
  packName?: string;
  /** A pack whose real format we cannot animate — imported as static thumbnails. */
  animated?: boolean;
}

/** How many of a pack's stickers the in-window preview shows before it stops adding rows. */
const PREVIEW_CAP = 12;

/**
 * Add a GIF, or a whole sticker pack, by pasting a link.
 *
 * ── IT IS THE APP'S OWN SHEET NOW, NOT A SHAPE OF MY OWN ────────────────────
 *
 * Two wrong answers before this one: a full screen, then a centred card. Both were invented here, and
 * neither matched anything else in the app — which is the actual complaint. The app HAS a modal, and it is
 * `SlideUpSheet`: spring slide-up from the bottom, a 0.4 backdrop fading in over 200 ms, 250 ms slide-down
 * on close. It is what the profile-edit sheet uses, what the feed's three-dots menu uses, and what the
 * share sheet uses. So this uses it too, and owns none of that chrome itself.
 *
 * The explanation of which links work is still here and still needed — "Copy Link" from Discord gives a
 * page and not a file, and knowing that is the difference between success and confusion. It sits behind
 * the `⋯` toggle, closed by default, so the sheet stays short and is complete on demand. That was the
 * right half of the previous attempt and is kept.
 *
 * NOTE for anyone extending this: `SlideUpSheet` is itself an RN `<Modal>`, so nothing in here may open
 * another one. On Android a nested Modal renders BEHIND its parent and its teardown can leave the screen
 * unresponsive — the warning is recorded at length in `EditProfileTabModal`, which hit it.
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
  // Telegram's own words, when there are any. Shown small under the message so a rate limit or a dead
  // token is distinguishable from a wrong name - reported as `непонятно, что это` when every cause
  // printed the same sentence.
  const [detail, setDetail] = useState<string | null>(null);
  const [resolved, setResolved] = useState<Resolved | null>(null);
  // Consumed by SlideUpSheet on the next close, then reset by it. See the three-dots handler.
  const exitInstantRef = useRef(false);
  const add = useCustomGifs((s) => s.add);
  const addMany = useCustomGifs((s) => s.addMany);

  const reset = useCallback(() => {
    setUrl('');
    setError(null);
    setDetail(null);
    setResolved(null);
    setBusy(false);
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
      setDetail(null);
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
              : res.reason === 'unauthorised'
                ? labels.errPackAuth
                : res.reason === 'empty'
                  ? labels.errPackEmpty
                  : labels.errPackNotFound,
          );
          setDetail(res.detail || null);
          return;
        }
        setResolved({ urls: res.pack.urls, title: res.pack.title, animated: res.pack.animated, packName: res.pack.name });
        return;
      }

      const single = await validateGifLink(target);
      setBusy(false);
      if (!single.ok) {
        setError(
          single.reason === 'not_https'
            ? labels.errNotHttps
            : single.reason === 'tg_message'
              ? labels.errTgMessage
              : labels.errNotMedia,
        );
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
    // The pack's short name travels with the stickers, so the long-press menu can offer "View pack".
    else addMany(resolved.urls, resolved.packName);
    triggerHaptic('medium');
    showToast(labels.added, 'check');
    close();
  }, [resolved, add, addMany, labels.added, close]);

  const hasText = url.trim().length > 0;
  const primaryLabel = resolved ? labels.add : labels.find;
  const primaryEnabled = !busy && (resolved ? true : hasText);
  const onPrimary = resolved ? commit : () => void resolve(url);

  return (
    <SlideUpSheet visible={visible} onClose={close} exitInstantRef={exitInstantRef}>
      <View style={styles.card}>
          <View style={styles.header}>
            <RNText style={[styles.title, { color: theme.colors.text.primary }]}>{labels.title}</RNText>
            {/* ── THE THREE DOTS OPEN THE LIBRARY NOW, NOT A HINT PARAGRAPH ─────────
   
                Asked for: tapping the three-dots should send this sheet up and open a full window
                showing the date and which GIFs were imported.
   
                It used to expand the instructions inline. Those have not been dropped — they moved onto
                that screen, where they fit better anyway: someone typing into this field has already
                worked out what to paste, while someone opening the library is the one asking what can be
                imported. One button, and the thing behind it now answers both questions.
   
                `exitUpRef` before `close()` is what makes it read as a handoff rather than two unrelated
                events: the sheet leaves upward and the screen arrives, instead of the sheet dropping away
                and something unrelated pushing in from the side. */}
            <Pressable
              onPress={() => {
                triggerHaptic('light');
                // ── ONE TRANSITION, NOT TWO OVERLAPPING ONES ──────────────────────────
                //
                // This has now been wrong in both directions, so both are recorded.
                //
                // First it was `close()` then `router.push` on a timer. `SlideUpSheet` only calls
                // `onClose` after its 250 ms exit, plus 30 ms of timer, so the sheet was gone for the
                // better part of a third of a second before anything replaced it — dead time, reported
                // as a freeze.
                //
                // So I reversed it: push first, let the sheet fly up over the incoming screen. That
                // removed the gap and introduced something worse — "it disappears, hangs for a
                // millisecond, hangs again, disappears again". Which is what running BOTH transitions at
                // once actually looks like here: this sheet lives inside an RN `<Modal>`, and presenting
                // a route while a Modal is up makes iOS re-composite the window — the new screen appears
                // behind the Modal, the Modal then animates out on the JS-driven value, and
                // `SlideUpSheet`'s own `visible || mounted` bookkeeping commits twice more on the way.
                // Several visual events for one user action, which is exactly the stutter described.
                //
                // A handoff does not need a farewell. `exitInstantRef` drops the sheet in a single
                // commit and the route slides in over where it was: ONE animation, owned by the
                // navigator, with nothing for it to fight. That is also what makes it predictable — the
                // previous two versions were both timing-dependent, and this one has no timing at all.
                //
                // `as any` on the route, matching `settings/index.tsx`'s push to `/settings/pixel-icons`.
                // expo-router GENERATES its route union into `.expo/types/router.d.ts`, which is
                // gitignored and only rewritten when the dev server or a build runs — so a screen added
                // recently is not in the union yet even though the file exists and the path is correct.
                // The alternative is editing generated output, which the next build discards.
                exitInstantRef.current = true;
                close();
                router.push('/settings/stickers' as any);
              }}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={labels.title}
              style={styles.iconBtn}
            >
              <Feather name="more-horizontal" size={19} color={theme.colors.text.secondary} />
            </Pressable>
          </View>

          <View style={[styles.inputRow, { borderColor: error ? '#FF3B30' : theme.colors.border.light }]}>
            <TextInput
              value={url}
              onChangeText={(v) => { setUrl(v); setError(null); setDetail(null); setResolved(null); }}
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
          {/* Diagnostic, and NOT in small grey print any more.
   
              It was, and that was a mistake that cost several rounds: the pack name and the blocking format
              were being reported all along, in a line the user never mentioned once — so each report came
              back as "same error" and each reply from me was another guess. A detail nobody reads is the
              same as a detail nobody collected.
   
              Same colour and weight as the error itself now, boxed so it reads as part of the failure
              rather than as decoration. */}
          {detail ? (
            <View style={[styles.detailBox, { borderColor: theme.colors.border.light }]}>
              <RNText selectable style={[styles.detail, { color: theme.colors.text.secondary }]}>{detail}</RNText>
            </View>
          ) : null}

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
    </SlideUpSheet>
  );
}

const styles = StyleSheet.create({
  // No surface, no rounding, no backdrop, no shadow here: SlideUpSheet owns all of it, which is the
  // point of using it. This is only the sheet's inner padding.
  card: { paddingHorizontal: 18, paddingTop: 4, paddingBottom: 6 },
  header: { flexDirection: 'row', alignItems: 'center' },
  title: { fontSize: 17, fontWeight: '700', flex: 1 },
  iconBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  hint: { fontSize: 12, lineHeight: 18, marginTop: 6 },
  inputRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 12, paddingLeft: 12, paddingRight: 4, marginTop: 12, height: 46 },
  input: { flex: 1, fontSize: 14, paddingVertical: 0 },
  pasteBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  error: { color: '#FF3B30', fontSize: 12, lineHeight: 18, marginTop: 8 },
  // `selectable` on the text plus a visible box, so the diagnostic can be long-pressed and copied. The
  // whole point of it is to be sent to someone who can act on it.
  detailBox: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, marginTop: 8 },
  detail: { fontSize: 12, lineHeight: 17 },
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
