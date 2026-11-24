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
import { QrCodeView } from '../qr/QrCodeView';
import { QR_SCANNER_AVAILABLE, QrScanner } from '../qr/QrScanner';
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
  const layer = (cell: number, minSize: number, spread: number, minOpacity: number, opacitySpread: number, tag: string) => {
    const cols = Math.ceil(width / cell) + 1;
    const rows = Math.ceil(height / cell) + 1;
    const out: FieldEmoji[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const size = minSize + Math.round(rnd() * spread);
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
    far: layer(width / 4.2, 18, 8, 0.2, 0.12, 'f'),
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
        { width: size, height: size, borderRadius: size / 2, opacity: pressed ? 0.7 : 1 },
      ]}
    >
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

  // ── Motion ──
  const appear = useRef(new Animated.Value(0)).current;
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

  // In on `visible`, out when it clears. Reopened during the close, it simply comes back: the new
  // animation stops the old one, whose `finished` is then false, so the host is not told to unmount.
  useEffect(() => {
    if (visible) {
      hidingRef.current = false;
      Animated.timing(appear, { toValue: 1, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
      return;
    }
    if (hidingRef.current) return;
    hidingRef.current = true;
    Animated.timing(appear, { toValue: 0, duration: 240, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(
      ({ finished }) => {
        if (finished) onHidden();
      },
    );
  }, [visible, appear, onHidden]);

  const close = useCallback(() => {
    useProfileQrStore.getState().close();
  }, []);

  // ── Link menu, notice ──
  const [menuOpen, setMenuOpen] = useState(false);
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

  const bgOpacity = appear.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 1, 1] });
  const cardOpacity = appear.interpolate({ inputRange: [0, 0.15, 0.75, 1], outputRange: [0, 0, 1, 1] });
  const cardScale = appear.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] });
  const cardLift = appear.interpolate({ inputRange: [0, 1], outputRange: [22, 0] });
  const chromeOpacity = appear.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 0, 1] });

  const nearStyle = {
    transform: [
      { translateX: sway.interpolate({ inputRange: SWAY_IN, outputRange: SWAY_X }) },
      { translateY: sway.interpolate({ inputRange: SWAY_IN, outputRange: SWAY_Y }) },
    ],
  };
  const farStyle = {
    transform: [
      { translateX: sway.interpolate({ inputRange: SWAY_IN, outputRange: SWAY_X_FAR }) },
      { translateY: sway.interpolate({ inputRange: SWAY_IN, outputRange: SWAY_Y_FAR }) },
    ],
  };
  // No hardware layer on the fields: measured with and without, both 0 janky frames of ~245 in 4 s at
  // rest, and a layer would hold a screen-sized texture per field for as long as the screen is open.
  const fieldBox = { position: 'absolute' as const, left: -OVERHANG_X, top: -OVERHANG_Y, width: fieldW, height: fieldH };

  const menuStyle = {
    opacity: menuAnim,
    transform: [
      { translateY: menuAnim.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) },
      { scale: menuAnim.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
    ],
  };

  const bottomY = insets.bottom + 24;

  return (
    <View style={styles.root} pointerEvents={visible ? 'auto' : 'none'}>
      <StatusBar style="light" />
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: bgOpacity }]}>
        <LinearGradient colors={[bgTop, bgMid, bgBottom]} locations={[0, 0.55, 1]} style={StyleSheet.absoluteFill} />
        <Animated.View pointerEvents="none" style={[fieldBox, farStyle]}>
          <EmojiField items={field.far} />
        </Animated.View>
        <Animated.View pointerEvents="none" style={[fieldBox, nearStyle]}>
          <EmojiField items={field.near} />
        </Animated.View>
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
          <QrCodeView
            value={url}
            size={qrSize}
            color={ink}
            center={<RNText allowFontScaling={false} style={emojiTextStyle(Math.round(qrSize * 0.12))}>{emoji}</RNText>}
          />
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

      <Animated.View style={[styles.topBar, { top: insets.top + 10, opacity: chromeOpacity }]} pointerEvents="box-none">
        <RoundButton onPress={close} label={t('common.close')}>
          <Feather name="x" size={22} color="#FFFFFF" />
        </RoundButton>
        {QR_SCANNER_AVAILABLE ? (
          <RoundButton onPress={openScanner} label={t('qr.scan', 'Сканировать QR-код')}>
            <MaterialIcons name="qr-code-scanner" size={22} color="#FFFFFF" />
          </RoundButton>
        ) : null}
      </Animated.View>

      <Animated.View style={[styles.bottomBar, { bottom: bottomY, opacity: chromeOpacity }]} pointerEvents="box-none">
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
  round: {
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
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
