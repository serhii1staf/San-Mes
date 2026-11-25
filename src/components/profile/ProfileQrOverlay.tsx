/**
 * The profile QR screen (Nov 2026 redesign), for your own profile and for anyone else's.
 *
 * Asked for, with a Telegram screenshot: it opens and closes smoothly "без каких-либо артефактов"; a
 * white rounded card with the QR and the @username under it; a cross top left and "отсканировать
 * QR-код" top right; bottom left a small menu to copy the link, bottom right Save; no customisation;
 * and behind it all, emoji that move "как будто кто-то снимает с body cam".
 *
 * ── HOW IT IS BUILT, AND WHY THAT WAY ────────────────────────────────────────
 *
 *   Not an RN `<Modal>`. The old QR was a Modal, opened from inside another Modal (the profile menu),
 *   and two Modals presented together on iOS end with the second one never appearing. One host at the
 *   root (`ProfileQrHost`, src/store/profileQrStore.ts) draws this over the navigator instead.
 *
 *   The QR is made on the device (src/utils/qrMatrix.ts) and cached per link for the session: no image
 *   request, no blank square while one loads, nothing sent to a third party. That was the
 *   "перезагружается ... лишние запросы к серверу" report.
 *
 *   Every animation is React Native's Animated on the native driver, transform and opacity only, the
 *   way the sign-up screen does it: Reanimated 4 here commits the shadow tree on every animated frame
 *   on Android, and the background moves for as long as the screen is open. The "body cam" motion is
 *   a translation of two emoji layers (a slow drift, a sway and a walking bob, summed sines sampled
 *   into an interpolation), the far layer moving half as much, so it has depth; the emoji themselves
 *   are laid out once and never re-render. See "TRANSLATION ONLY" below for why nothing rotates.
 *
 *   Opening fades the background in and lifts the card from 90 % with a fade; closing is the same,
 *   backwards and quicker, and only then does the host unmount it. Everything starts at opacity 0, so
 *   no frame shows anything before the animation.
 *
 * ── THE OPEN WAS NEVER SEEN ON A FIRST OPEN, AND THE CLOSE WAS A CUT (Nov 2026) ──
 *
 *   Reported with a screen recording: the open animation "как будто плохая", the close "очень твёрдая,
 *   сухая", and the round buttons have no liquid glass.
 *
 *   The recording, frame by frame (iPhone, 48 fps): after the tap the profile stood still for 14 frames
 *   (290 ms), and the first frame of this screen already had the background and the card at full
 *   opacity, the card empty; the code then faded in. So the open animation had run and finished
 *   inside that stall. It started from the mount effect, and the native driver counts from the moment
 *   it receives the animation, so a first frame that takes 290 ms to draw (about ninety emoji views,
 *   each rasterised on the main thread the first time) lands with the animation all but over.
 *   The close took 240 ms on `Easing.in(cubic)` with the background held at full until the value
 *   fell under 0.6: nothing moved for 180 ms, then everything went in three frames.
 *
 *   Now:
 *   - The open waits until the screen has been drawn: its own layout, then two frames, and the code
 *     encoded first (`warmQrCode`), so the card never shows empty.
 *   - The emoji field is mounted after the open, invisible, and fades in once it has been drawn, so
 *     its first rasterisation can no longer swallow the open.
 *   - Background, card and buttons each have their own value and curve. The card springs up out of a
 *     small drop; the buttons slide in from their own edges (translation only, which keeps the system
 *     glass alive: an alpha below 1 on a glass view's ancestor switches it off, expo/expo#41024).
 *   - The close starts moving on its first frame and decelerates: everything dissolves together, the
 *     card sinking a little, the buttons leaving through their edges.
 *   - The four round buttons share the photo viewer's surface (`OverlayButtonSurface`): on iOS the
 *     system blur with the glass's lit rim, since our capturing glass re-captured on every frame here.
 */
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  BackHandler,
  Easing,
  Linking,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text as RNText,
  View,
  useWindowDimensions,
} from 'react-native';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { Text } from '../ui/Text';
import { emojiTextStyle } from '../ui/emojiText';
import { QrCodeView, warmQrCode } from '../qr/QrCodeView';
import { QR_SCANNER_AVAILABLE, QrScanner } from '../qr/QrScanner';
import { OverlayButtonSurface } from '../ui/OverlayButtonSurface';
import { isQrCached } from '../../utils/qrMatrix';
import { useT } from '../../i18n/store';
import { triggerHaptic } from '../../utils/haptics';
import { buildProfileShareUrl, resolveInAppHref } from '../../utils/appLinks';
import { useProfileQrStore, type ProfileQrTarget } from '../../store/profileQrStore';

// ── Colours ───────────────────────────────────────────────────────────────

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map((ch) => ch + ch).join('') : m[1];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** `a` mixed toward `b` by `t` (0..1). Falls back to `b` for a colour it cannot read. */
function mix(a: string, b: string, t: number): string {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!cb) return b;
  if (!ca) return b;
  const c = ca.map((v, i) => Math.round(v + (cb[i] - v) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

// ── The "body cam" motion ─────────────────────────────────────────────────
//
// One loop of SWAY_MS drives everything. Only whole harmonics of the loop are used, so the end of a
// loop meets its start exactly and nothing jumps when it repeats: a drift over the whole loop, a sway
// three to five times faster, and a bob at 25 cycles per loop (0.83 Hz, a walking pace), small.

//
// ── TRANSLATION ONLY, AND WHY ──────────────────────────────────────────────
// Measured on the emulator, the screen at rest for 4 s: with the field also rotating and scaling,
// 94 frames, 75 of them janky (every frame re-rasterised each emoji at a new angle and size); moving
// it only, 254 frames, 13 janky. The depth a rotation gave is made by parallax instead: two layers,
// the far one smaller, fainter and moving about half as much.

const SWAY_MS = 30000;
const SWAY_SAMPLES = 240;
const TAU = Math.PI * 2;
const SWAY_IN = Array.from({ length: SWAY_SAMPLES + 1 }, (_, i) => i / SWAY_SAMPLES);
const SWAY_X = SWAY_IN.map((p) => 14 * Math.sin(TAU * p) + 6 * Math.sin(TAU * 3 * p + 1.1) + 1.8 * Math.sin(TAU * 25 * p));
const SWAY_Y = SWAY_IN.map(
  (p) => 10 * Math.sin(TAU * 2 * p + 0.6) + 5 * Math.sin(TAU * 5 * p + 2) + 2.6 * Math.sin(TAU * 25 * p + 1.6),
);
const FAR = 0.5;
const SWAY_X_FAR = SWAY_X.map((v) => v * FAR);
const SWAY_Y_FAR = SWAY_Y.map((v) => v * FAR);
/** The most the near layer ever moves from rest, plus a little; the field overhangs the screen by it. */
const OVERHANG_X = 26;
const OVERHANG_Y = 22;

// ── The emoji field ───────────────────────────────────────────────────────

const POOL = ['✨', '💬', '🎧', '📸', '🌙', '⭐', '💜', '🎮', '🍀', '🚀', '🌸', '🎵', '🔥', '💎', '🦋', '🌈', '🎈', '😎'];

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function random(seed: number): () => number {
  let s = seed || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

interface FieldEmoji {
  key: string;
  emoji: string;
  left: number;
  top: number;
  size: number;
  rotate: string;
  opacity: number;
}

/**
 * Two jittered grids (near and far), overhanging the screen by the sway's reach so it never shows an
 * edge. Seeded by the profile id, so a profile's pattern is the same every time it is opened.
 */
function buildField(width: number, height: number, seed: string, ownEmoji: string): { near: FieldEmoji[]; far: FieldEmoji[] } {
  const rnd = random(hashString(seed));
  // Sizes in steps of 4 pt: an emoji is rasterised once per size the first time it is drawn (on iOS on
  // the main thread), and with a size per point almost every emoji in the field was a new one.
  const layer = (cell: number, minSize: number, spread: number, minOpacity: number, opacitySpread: number, tag: string) => {
    const cols = Math.ceil(width / cell) + 1;
    const rows = Math.ceil(height / cell) + 1;
    const out: FieldEmoji[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const size = minSize + Math.round((rnd() * spread) / 4) * 4;
        const jx = (rnd() - 0.5) * cell * 0.6;
        const jy = (rnd() - 0.5) * cell * 0.6;
        // Every other row shifted by half a cell reads less like a grid.
        const x = (c + (r % 2 ? 0.5 : 0)) * cell + jx;
        const y = r * cell + jy;
        out.push({
          key: `${tag}${r}:${c}`,
          emoji: rnd() < 0.34 ? ownEmoji : POOL[Math.floor(rnd() * POOL.length)],
          left: x - size / 2,
          top: y - size / 2,
          size,
          rotate: `${Math.round((rnd() - 0.5) * 52)}deg`,
          opacity: minOpacity + rnd() * opacitySpread,
        });
      }
    }
    return out;
  };
  return {
    // About 45 small faint ones (was 60) and 28 large ones.
    far: layer(width / 3.6, 18, 8, 0.2, 0.12, 'f'),
    near: layer(width / 2.6, 30, 14, 0.36, 0.2, 'n'),
  };
}

const EmojiField = memo(function EmojiField({ items }: { items: FieldEmoji[] }) {
  return (
    <>
      {items.map((e) => (
        <RNText
          key={e.key}
          allowFontScaling={false}
          style={[
            emojiTextStyle(e.size),
            { position: 'absolute', left: e.left, top: e.top, opacity: e.opacity, transform: [{ rotate: e.rotate }] },
          ]}
        >
          {e.emoji}
        </RNText>
      ))}
    </>
  );
});

// ── Small round button ────────────────────────────────────────────────────

// Asked: "почему кнопочка вот тут жидкость стекло не поддерживается?" It was a flat 16 % white disc.
// Now the same surface the photo viewer's buttons use: glass where it is on, a dark blur where it is
// off. The glass sits BEHIND the icon as a sibling (inside a glass view an icon is warped), the button
// clips it round, and a press scales rather than fades (an alpha would switch the system glass off).
function RoundButton({
  onPress,
  label,
  size = 46,
  children,
}: {
  onPress: () => void;
  label: string;
  size?: number;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.round,
        { width: size, height: size, borderRadius: size / 2, transform: [{ scale: pressed ? 0.92 : 1 }] },
      ]}
    >
      {/* Not our capturing glass on iOS: these slide in and out and sit over an emoji field that never
          stops moving, so each one re-captured on every frame. See `OverlayButtonSurface`. */}
      <OverlayButtonSurface radius={size / 2} />
      {children}
    </Pressable>
  );
}

// ── The screen ────────────────────────────────────────────────────────────

function ProfileQrOverlay({
  target,
  visible,
  onHidden,
}: {
  target: ProfileQrTarget;
  visible: boolean;
  onHidden: () => void;
}) {
  const theme = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const { width: W, height: H } = useWindowDimensions();
  const accent = theme.colors.accent.primary;

  const url = buildProfileShareUrl(target.id);
  const emoji = target.emoji || '😊';
  const handle = target.username ? `@${target.username}` : target.displayName || '';

  // Colours from the theme's accent: a deep gradient behind, the code itself a darkened accent
  // (dark enough on white for any accent the app offers, the light "Песок" included).
  const bgTop = mix(accent, '#05050A', 0.45);
  const bgMid = mix(accent, '#05050A', 0.62);
  const bgBottom = mix(accent, '#05050A', 0.8);
  const ink = mix(accent, '#0B0B12', 0.45);

  const fieldW = W + OVERHANG_X * 2;
  const fieldH = H + OVERHANG_Y * 2;
  const field = useMemo(() => buildField(fieldW, fieldH, target.id, emoji), [fieldW, fieldH, target.id, emoji]);

  // ── Motion ── (see "THE OPEN WAS NEVER SEEN" at the top of the file)
  const bg = useRef(new Animated.Value(0)).current;
  const card = useRef(new Animated.Value(0)).current;
  const cardFade = useRef(new Animated.Value(0)).current;
  const chrome = useRef(new Animated.Value(0)).current;
  const fieldFade = useRef(new Animated.Value(0)).current;
  const sway = useRef(new Animated.Value(0)).current;
  const menuAnim = useRef(new Animated.Value(0)).current;
  const noticeAnim = useRef(new Animated.Value(0)).current;
  const hidingRef = useRef(false);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(sway, { toValue: 1, duration: SWAY_MS, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [sway]);

  // The code is made before the screen shows, so the card never appears empty. A link already made
  // (in memory or on disk) is ready at once; a new one is made on the next frame, while nothing shows.
  const [codeReady, setCodeReady] = useState(() => isQrCached(url, 'H'));
  useEffect(() => {
    if (codeReady) return;
    const raf = requestAnimationFrame(() => {
      // Ready either way: if making the code failed here, the screen must still open (the code
      // view then tries on its own), not sit invisible over the app taking its touches.
      try {
        warmQrCode(url, true);
      } catch {}
      setCodeReady(true);
    });
    return () => cancelAnimationFrame(raf);
  }, [codeReady, url]);

  const [laidOut, setLaidOut] = useState(false);
  const onRootLayout = useCallback(() => setLaidOut(true), []);
  // Mounted once the open has finished; see `onFieldLayout`.
  const [fieldMounted, setFieldMounted] = useState(false);

  const runOpen = useCallback(() => {
    hidingRef.current = false;
    Animated.parallel([
      Animated.timing(bg, { toValue: 1, duration: 300, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(cardFade, { toValue: 1, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      // A little overshoot: the card settles rather than stops.
      Animated.spring(card, { toValue: 1, damping: 17, stiffness: 180, mass: 0.9, useNativeDriver: true }),
      Animated.spring(chrome, { toValue: 1, damping: 22, stiffness: 210, mass: 0.9, useNativeDriver: true }),
    ]).start(({ finished }) => {
      if (finished) setFieldMounted(true);
    });
  }, [bg, cardFade, card, chrome]);

  // In once it has been drawn: its own layout, then two frames. On iOS a frame callback waits for the
  // main thread, so the second one runs after the first frame of this screen is on the glass, however
  // long that frame took to draw, and the animation starts from its beginning.
  useEffect(() => {
    if (!visible || !laidOut || !codeReady) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(runOpen);
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [visible, laidOut, codeReady, runOpen]);

  // Out when `visible` clears. It moves from its first frame and decelerates, all of it together, and
  // only then is the host told to unmount. Reopened during the close, it simply comes back: the open
  // stops this, whose `finished` is then false, so the host is not told.
  useEffect(() => {
    if (visible || hidingRef.current) return;
    hidingRef.current = true;
    const curve = Easing.bezier(0.33, 0, 0.2, 1);
    Animated.parallel([
      Animated.timing(bg, { toValue: 0, duration: 320, easing: curve, useNativeDriver: true }),
      Animated.timing(cardFade, { toValue: 0, duration: 240, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(card, { toValue: 0, duration: 300, easing: curve, useNativeDriver: true }),
      Animated.timing(chrome, { toValue: 0, duration: 280, easing: curve, useNativeDriver: true }),
      Animated.timing(menuAnim, { toValue: 0, duration: 160, easing: curve, useNativeDriver: true }),
    ]).start(({ finished }) => {
      if (finished) onHidden();
    });
  }, [visible, bg, cardFade, card, chrome, menuAnim, onHidden]);

  // The emoji field mounts invisible and fades in once it has been drawn (layout, then two frames), so
  // the cost of rasterising it the first time is paid while nothing of it shows.
  const fieldShown = useRef(false);
  const onFieldLayout = useCallback(() => {
    if (fieldShown.current) return;
    fieldShown.current = true;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        Animated.timing(fieldFade, { toValue: 1, duration: 650, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
      }),
    );
  }, [fieldFade]);

  const close = useCallback(() => {
    useProfileQrStore.getState().close();
  }, []);

  // ── Link menu, notice ──
  const [menuOpen, setMenuOpen] = useState(false);
  // The close fades the menu with everything else; it must not come back open if the screen does.
  useEffect(() => {
    if (!visible) setMenuOpen(false);
  }, [visible]);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showNotice = useCallback(
    (text: string) => {
      setNotice(text);
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      noticeAnim.setValue(0);
      Animated.timing(noticeAnim, { toValue: 1, duration: 180, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
      noticeTimer.current = setTimeout(() => {
        Animated.timing(noticeAnim, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => setNotice(null));
      }, 1600);
    },
    [noticeAnim],
  );
  useEffect(() => () => { if (noticeTimer.current) clearTimeout(noticeTimer.current); }, []);

  const toggleMenu = useCallback(() => {
    triggerHaptic('selection');
    setMenuOpen((open) => {
      const next = !open;
      Animated.timing(menuAnim, {
        toValue: next ? 1 : 0,
        duration: next ? 200 : 150,
        easing: next ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start();
      return next;
    });
  }, [menuAnim]);

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    Animated.timing(menuAnim, { toValue: 0, duration: 150, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start();
  }, [menuAnim]);

  const copyLink = useCallback(async () => {
    closeMenu();
    try {
      await Clipboard.setStringAsync(url);
      triggerHaptic('light');
      showNotice(t('toast.link_copied'));
    } catch {
      showNotice(t('toast.error_generic'));
    }
  }, [closeMenu, url, showNotice, t]);

  const shareLink = useCallback(() => {
    closeMenu();
    // iOS takes the link as `url` (the sheet shows its preview); Android only reads `message`.
    void Share.share(Platform.OS === 'ios' ? { url } : { message: url }).catch(() => {});
  }, [closeMenu, url]);

  // ── Save ──
  const cardRef = useRef<View>(null);
  const [saving, setSaving] = useState(false);
  const save = useCallback(async () => {
    if (saving) return;
    closeMenu();
    setSaving(true);
    triggerHaptic('light');
    try {
      const { captureRef } = await import('react-native-view-shot');
      const raw = await captureRef(cardRef, { format: 'png', quality: 1, result: 'tmpfile' });
      const fileUri = raw.startsWith('file:') ? raw : `file://${raw}`;
      const { saveImageToGallery } = await import('../../services/saveImageToGallery');
      const result = await saveImageToGallery(fileUri);
      showNotice(
        result === 'saved'
          ? t('qr.saved', 'QR-код сохранён в Фото')
          : result === 'denied'
            ? t('qr.save_denied', 'Нет доступа к Фото')
            : t('toast.error_generic'),
      );
    } catch {
      showNotice(t('toast.error_generic'));
    } finally {
      setSaving(false);
    }
  }, [saving, closeMenu, showNotice, t]);

  // ── Scanner ──
  const [scanning, setScanning] = useState(false);
  const openScanner = useCallback(() => {
    closeMenu();
    triggerHaptic('light');
    setScanning(true);
  }, [closeMenu]);
  const closeScanner = useCallback(() => setScanning(false), []);

  const onCode = useCallback(
    (data: string, resume: () => void) => {
      const href = resolveInAppHref(data);
      if (href) {
        // Ours (a profile, a post): open it and put the QR screen away underneath.
        close();
        router.push(href as any);
        return;
      }
      const isLink = /^https?:\/\//i.test(data);
      const buttons: { text: string; style?: 'cancel'; onPress?: () => void }[] = [
        { text: t('common.cancel'), style: 'cancel', onPress: resume },
        {
          text: t('common.copy'),
          onPress: () => {
            void Clipboard.setStringAsync(data).catch(() => {});
            resume();
          },
        },
      ];
      if (isLink) {
        buttons.push({
          text: t('qr.open_link', 'Открыть ссылку'),
          onPress: () => {
            void Linking.openURL(data).catch(() => {});
            resume();
          },
        });
      }
      Alert.alert(t('qr.scanned_title', 'QR-код'), data, buttons, { cancelable: true, onDismiss: resume });
    },
    [close, t],
  );

  // Android back: the scanner, then the menu, then the screen.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (scanning) setScanning(false);
      else if (menuOpen) closeMenu();
      else close();
      return true;
    });
    return () => sub.remove();
  }, [scanning, menuOpen, closeMenu, close]);

  // ── Layout ──
  const cardW = Math.min(W - 64, 330);
  const cardPad = 22;
  const qrSize = cardW - cardPad * 2;

  // ── THE CODE STAYED AFTER THE SCREEN HAD GONE (Nov 2026) ──────────────────────────────────────
  //
  // Reported: on close the screen disappears, and the QR code in the middle is still there, fading on
  // its own. The card had its own timeline: the background faded on a curve that starts slowly and
  // ends fast, while the card shrank and sank on another for 300 ms. Over a light profile, once the
  // dark gradient had thinned the white card vanished into the page, and the dark dots of the code,
  // the most contrasted thing left, floated in the middle shrinking after the window had gone. So the
  // card's alpha is now the background's times its own: it can never outlast the window, on the open
  // or the close. The shrink and the sink stay, under a card that is already almost invisible.
  //
  // Memoized, like every interpolation here: built in the render, each render (the code becoming
  // ready, the layout, the field mounting, the link menu) handed the native driver new nodes for
  // views that were mid-animation.
  const cardOpacity = useMemo(() => Animated.multiply(bg, cardFade), [bg, cardFade]);
  const cardScale = useMemo(() => card.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] }), [card]);
  const cardLift = useMemo(() => card.interpolate({ inputRange: [0, 1], outputRange: [36, 0] }), [card]);
  // Off their own edges and back: translation only, see `RoundButton`.
  const topChromeY = useMemo(
    () => chrome.interpolate({ inputRange: [0, 1], outputRange: [-(insets.top + 80), 0] }),
    [chrome, insets.top],
  );
  const bottomChromeY = useMemo(
    () => chrome.interpolate({ inputRange: [0, 1], outputRange: [insets.bottom + 110, 0] }),
    [chrome, insets.bottom],
  );

  const nearStyle = useMemo(() => ({
    transform: [
      { translateX: sway.interpolate({ inputRange: SWAY_IN, outputRange: SWAY_X }) },
      { translateY: sway.interpolate({ inputRange: SWAY_IN, outputRange: SWAY_Y }) },
    ],
  }), [sway]);
  const farStyle = useMemo(() => ({
    transform: [
      { translateX: sway.interpolate({ inputRange: SWAY_IN, outputRange: SWAY_X_FAR }) },
      { translateY: sway.interpolate({ inputRange: SWAY_IN, outputRange: SWAY_Y_FAR }) },
    ],
  }), [sway]);
  // A new element on every render defeated `QrCodeView`'s memo, so each render of this screen redrew
  // the code's thousand dots.
  const qrCenter = useMemo(
    () => <RNText allowFontScaling={false} style={emojiTextStyle(Math.round(qrSize * 0.12))}>{emoji}</RNText>,
    [qrSize, emoji],
  );
  // No hardware layer on the fields: measured with and without, both 0 janky frames of ~245 in 4 s at
  // rest, and a layer would hold a screen-sized texture per field for as long as the screen is open.
  const fieldBox = { position: 'absolute' as const, left: -OVERHANG_X, top: -OVERHANG_Y, width: fieldW, height: fieldH };

  const menuStyle = useMemo(() => ({
    opacity: menuAnim,
    transform: [
      { translateY: menuAnim.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) },
      { scale: menuAnim.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
    ],
  }), [menuAnim]);

  const bottomY = insets.bottom + 24;

  return (
    <View style={styles.root} pointerEvents={visible ? 'auto' : 'none'} onLayout={onRootLayout}>
      <StatusBar style="light" />
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: bg }]}>
        <LinearGradient colors={[bgTop, bgMid, bgBottom]} locations={[0, 0.55, 1]} style={StyleSheet.absoluteFill} />
        {fieldMounted ? (
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: fieldFade }]} onLayout={onFieldLayout}>
            <Animated.View pointerEvents="none" style={[fieldBox, farStyle]}>
              <EmojiField items={field.far} />
            </Animated.View>
            <Animated.View pointerEvents="none" style={[fieldBox, nearStyle]}>
              <EmojiField items={field.near} />
            </Animated.View>
          </Animated.View>
        ) : null}
        {/* Darker at the top and the bottom, so the buttons read over any emoji. */}
        <LinearGradient
          pointerEvents="none"
          colors={['rgba(0,0,0,0.45)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0.5)']}
          locations={[0, 0.22, 0.72, 1]}
          style={StyleSheet.absoluteFill}
        />
        {/* A tap on the background closes, like the old screen did. */}
        <Pressable style={StyleSheet.absoluteFill} onPress={menuOpen ? closeMenu : close} accessible={false} />
      </Animated.View>

      <Animated.View
        style={[
          styles.cardWrap,
          { opacity: cardOpacity, transform: [{ translateY: cardLift }, { scale: cardScale }] },
        ]}
        pointerEvents="box-none"
      >
        <View
          ref={cardRef}
          collapsable={false}
          // The code is one path of about a thousand dots, and the background behind it moves on every
          // frame, so Android would replay that path each frame; as a layer it is drawn once. (iOS keeps
          // the drawn SVG in its layer's backing store anyway.)
          renderToHardwareTextureAndroid
          style={[styles.card, { width: cardW, padding: cardPad }]}
        >
          {codeReady ? (
            <QrCodeView
              value={url}
              size={qrSize}
              color={ink}
              center={qrCenter}
            />
          ) : (
            // Never seen: the screen does not show until the code exists (see `codeReady`).
            <View style={{ width: qrSize, height: qrSize }} />
          )}
          {handle ? (
            <Text
              variant="subheading"
              weight="bold"
              align="center"
              color={ink}
              numberOfLines={1}
              style={styles.handle}
            >
              {handle}
            </Text>
          ) : null}
        </View>
      </Animated.View>

      <Animated.View style={[styles.topBar, { top: insets.top + 10, transform: [{ translateY: topChromeY }] }]} pointerEvents="box-none">
        <RoundButton onPress={close} label={t('common.close')}>
          <Feather name="x" size={22} color="#FFFFFF" />
        </RoundButton>
        {QR_SCANNER_AVAILABLE ? (
          <RoundButton onPress={openScanner} label={t('qr.scan', 'Сканировать QR-код')}>
            <MaterialIcons name="qr-code-scanner" size={22} color="#FFFFFF" />
          </RoundButton>
        ) : null}
      </Animated.View>

      <Animated.View style={[styles.bottomBar, { bottom: bottomY, transform: [{ translateY: bottomChromeY }] }]} pointerEvents="box-none">
        <RoundButton onPress={toggleMenu} label={t('qr.link_menu', 'Ссылка')} size={54}>
          <Feather name="link" size={22} color="#FFFFFF" />
        </RoundButton>
        <RoundButton onPress={save} label={t('qr.save', 'Сохранить')} size={54}>
          <Feather name={saving ? 'loader' : 'download'} size={22} color="#FFFFFF" />
        </RoundButton>
      </Animated.View>

      {/* The link menu, above its button. */}
      <Animated.View
        pointerEvents={menuOpen ? 'auto' : 'none'}
        style={[styles.menu, { left: 24, bottom: bottomY + 54 + 12 }, menuStyle]}
      >
        <Pressable onPress={copyLink} style={({ pressed }) => [styles.menuRow, pressed ? styles.menuRowPressed : null]}>
          <Feather name="copy" size={18} color="#FFFFFF" />
          <Text variant="body" color="#FFFFFF" style={styles.menuLabel}>{t('profile_menu.copy_link')}</Text>
        </Pressable>
        <View style={styles.menuHairline} />
        <Pressable onPress={shareLink} style={({ pressed }) => [styles.menuRow, pressed ? styles.menuRowPressed : null]}>
          <Feather name="share" size={18} color="#FFFFFF" />
          <Text variant="body" color="#FFFFFF" style={styles.menuLabel}>{t('qr.share_link', 'Поделиться ссылкой')}</Text>
        </Pressable>
      </Animated.View>

      {notice ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.notice,
            {
              bottom: bottomY + 54 + 16,
              opacity: noticeAnim,
              transform: [{ translateY: noticeAnim.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }],
            },
          ]}
        >
          <Text variant="caption" weight="semibold" color="#FFFFFF">{notice}</Text>
        </Animated.View>
      ) : null}

      {scanning ? <QrScanner onClose={closeScanner} onCode={onCode} /> : null}
    </View>
  );
}

export default ProfileQrOverlay;

const styles = StyleSheet.create({
  // Above the navigator, the mini bars and the chat peek menu (zIndex 1000). No elevation: on Android
  // that would also lift it over the toast, and its own notices are drawn inside it anyway.
  root: { ...StyleSheet.absoluteFillObject, zIndex: 1100 },
  cardWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 32,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.3,
    shadowRadius: 30,
    elevation: 12,
  },
  handle: { marginTop: 14, fontSize: 22 },
  topBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  bottomBar: {
    position: 'absolute',
    left: 24,
    right: 24,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  // Clipped, or the surface behind the icon paints square inside the round button.
  round: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  menu: {
    position: 'absolute',
    minWidth: 230,
    borderRadius: 20,
    // Opaque: it overlaps the white card, which showed through a translucent fill.
    backgroundColor: '#1B1B22',
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 22,
    elevation: 10,
    transformOrigin: 'bottom left',
  },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, height: 48 },
  menuRowPressed: { backgroundColor: 'rgba(255,255,255,0.08)' },
  menuLabel: { fontSize: 16 },
  menuHairline: { height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.14)', marginLeft: 46 },
  notice: {
    position: 'absolute',
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.62)',
  },
});
