import React, { useState } from 'react';
import { View, Pressable, ScrollView, StyleSheet, Text as RNText } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import {
  useThemeStore,
  FONT_FAMILIES,
  FONT_SIZES,
  FontFamily,
} from '../../src/store/themeStore';
import { useProfileAppearanceStore } from '../../src/store/profileAppearanceStore';
import { SlideUpSheet } from '../../src/components/ui/SlideUpSheet';
import { triggerHaptic } from '../../src/utils/haptics';
import { useT } from '../../src/i18n/store';
import { PixelIcon } from '../../src/components/pixel-icons/PixelIcon';
import { parseDecoration, emojiToken } from '../../src/components/pixel-icons/decoration';

// Inline-preview font for each family option. Mirrors the regular weight
// ThemeProvider builds, so the right-side font label renders in the family
// the user is currently using.
const FAMILY_PREVIEW_FONT: Record<FontFamily, string> = {
  inter: 'Inter_400Regular',
  system: 'System',
  serif: 'Georgia',
  mono: 'Courier',
};

const PROFILE_EMOJI_CHOICES = ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '⭐', '🌟', '✨', '💫', '🔥', '⚡', '🌈', '☀️', '🌙', '🌸', '🌺', '🌹', '🌻', '🌼', '🍀', '🌿', '🦋', '🐱', '🐶', '🐼', '🦊', '🐰', '🍑', '🍓', '🍉', '🍒', '🎵', '🎶', '🎨', '🎮', '👑', '😎', '🥰', '😇', '🤩', '💎', '🌊', '☕', '🍕', '⚽'];

export default function FontsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  const fontFamily = useThemeStore((s) => s.fontFamily);
  const fontSize = useThemeStore((s) => s.fontSize);
  const { postEmoji, setPostEmoji } = useProfileAppearanceStore();
  const [emojiModal, setEmojiModal] = useState(false);

  const bgPrimary = theme.colors.background.primary;
  const bgElevated = theme.colors.background.elevated;
  const borderLight = theme.colors.border.light;
  const textPrimary = theme.colors.text.primary;
  const textSecondary = theme.colors.text.secondary;
  const textTertiary = theme.colors.text.tertiary;

  const headerContentHeight = insets.top + 48;
  const headerGradientHeight = headerContentHeight + 28;
  const bgTransparent = bgPrimary + '00';

  // Right-side meta strings for the size + font rows
  const currentSize = FONT_SIZES.find((f) => f.key === fontSize) || FONT_SIZES[1];
  const currentFamily = FONT_FAMILIES.find((f) => f.key === fontFamily) || FONT_FAMILIES[0];
  const sizeMeta = `${t(`font.size.${currentSize.key}`, currentSize.label)} ${Math.round(currentSize.scale * 100)}%`;
  const familyMeta =
    currentFamily.key === 'system'
      ? t('font.family.system', currentFamily.label)
      : currentFamily.label;
  const familyPreviewFont = FAMILY_PREVIEW_FONT[currentFamily.key];

  const openSize = () => {
    triggerHaptic('selection');
    router.push('/settings/fonts-size');
  };

  const openFamily = () => {
    triggerHaptic('selection');
    router.push('/settings/fonts-family');
  };

  const openEmojiSheet = () => {
    triggerHaptic('selection');
    setEmojiModal(true);
  };

  const pickEmoji = (value: string) => {
    triggerHaptic('selection');
    // Empty string = off. Anything else is encoded with the explicit
    // `emoji:` prefix so the persisted JSON is self-describing —
    // legacy unprefixed entries remain readable via parseDecoration.
    setPostEmoji(value ? emojiToken(value) : '');
    setEmojiModal(false);
  };

  // Open the pixel-icons picker bound to this surface. Apply inside
  // the picker writes back via setPostEmoji with the `pixel:` prefix.
  const openPixelPicker = () => {
    triggerHaptic('selection');
    router.push('/settings/pixel-icons?purpose=post-emoji');
  };

  // Decoded current decoration drives both the right-side meta on the
  // card row and the active-state highlighting inside the emoji sheet.
  const decoration = parseDecoration(postEmoji);
  const activeEmoji = decoration.kind === 'emoji' ? decoration.value : '';
  const activePixelId = decoration.kind === 'pixel' ? decoration.id : null;

  return (
    <View style={{ flex: 1, backgroundColor: bgPrimary }}>
      {/* Gradient header — same fade pattern as settings/index.tsx */}
      <View
        style={[styles.headerWrapper, { height: headerGradientHeight }]}
        pointerEvents="box-none"
      >
        <LinearGradient
          colors={[bgPrimary, bgPrimary, bgTransparent]}
          locations={[0, 0.55, 1]}
          style={StyleSheet.absoluteFill}
        />
        <View
          style={[styles.headerRow, { paddingTop: insets.top + 8 }]}
          pointerEvents="auto"
        >
          <Pressable
            onPress={() => router.back()}
            hitSlop={10}
            style={[styles.headerBack, { left: theme.spacing.lg, top: insets.top + 8 }]}
          >
            <Feather name="chevron-left" size={24} color={textPrimary} />
          </Pressable>
          <Text variant="subheading" weight="bold">
            {t('settings.fonts')}
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingTop: headerContentHeight,
          paddingBottom: insets.bottom + 60,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Single grouped card — three rows that link out to dedicated
            preview screens (Telegram-style). Keeping the three settings
            in one card makes the screen feel like a tidy index rather
            than three independent sections. */}
        <View style={[styles.card, { backgroundColor: bgElevated, borderColor: borderLight }]}>
          {/* ── Размер текста ───────────────────────────────────── */}
          <Pressable
            onPress={openSize}
            style={[
              styles.row,
              { borderBottomWidth: 0.5, borderBottomColor: borderLight },
            ]}
          >
            <RNText allowFontScaling={false} style={[styles.rowLabel, { color: textPrimary }]}>
              {t('fonts.size_title')}
            </RNText>
            <View style={styles.rowRight}>
              <RNText
                allowFontScaling={false}
                style={[styles.rowMeta, { color: textTertiary }]}
                numberOfLines={1}
              >
                {sizeMeta}
              </RNText>
              <Feather
                name="chevron-right"
                size={16}
                color={textTertiary}
                style={{ marginLeft: 4 }}
              />
            </View>
          </Pressable>

          {/* ── Шрифт ────────────────────────────────────────────── */}
          <Pressable
            onPress={openFamily}
            style={[
              styles.row,
              { borderBottomWidth: 0.5, borderBottomColor: borderLight },
            ]}
          >
            <RNText allowFontScaling={false} style={[styles.rowLabel, { color: textPrimary }]}>
              {t('fonts.font_title')}
            </RNText>
            <View style={styles.rowRight}>
              <RNText
                allowFontScaling={false}
                style={[
                  styles.rowMeta,
                  { color: textSecondary, fontFamily: familyPreviewFont },
                ]}
                numberOfLines={1}
              >
                {familyMeta}
              </RNText>
              <Feather
                name="chevron-right"
                size={16}
                color={textTertiary}
                style={{ marginLeft: 4 }}
              />
            </View>
          </Pressable>

          {/* ── Декоративный эмодзи (unchanged) ─────────────────── */}
          <Pressable onPress={openEmojiSheet} style={[styles.row, { borderBottomWidth: 0.5, borderBottomColor: borderLight }]}>
            <RNText allowFontScaling={false} style={[styles.rowLabel, { color: textPrimary }]}>
              {t('fonts.decorative_emoji')}
            </RNText>
            <View style={styles.rowRight}>
              {activePixelId ? (
                // When a pixel icon is the current decoration, show it
                // here too so the user can see at a glance what's active
                // without opening the picker.
                <PixelIcon id={activePixelId} size={22} />
              ) : activeEmoji ? (
                <RNText style={styles.emojiChip} allowFontScaling={false}>
                  {activeEmoji}
                </RNText>
              ) : (
                <RNText
                  allowFontScaling={false}
                  style={[styles.rowMeta, { color: textTertiary }]}
                >
                  {t('fonts.off')}
                </RNText>
              )}
              <Feather
                name="chevron-right"
                size={16}
                color={textTertiary}
                style={{ marginLeft: 4 }}
              />
            </View>
          </Pressable>

          {/* ── Пиксель-иконка ──────────────────────────────────── */}
          {/* Routes to the existing pixel-icons screen with the
              post-emoji purpose so Apply writes back to the same
              postEmoji string (with a `pixel:` prefix). The
              EmojiPattern / PixelIconPattern in ProfilePostCard +
              UserProfilePostCard branches on the prefix. */}
          <Pressable onPress={openPixelPicker} style={styles.row}>
            <RNText allowFontScaling={false} style={[styles.rowLabel, { color: textPrimary }]}>
              Pixel icons
            </RNText>
            <View style={styles.rowRight}>
              {activePixelId ? (
                <PixelIcon id={activePixelId} size={22} />
              ) : (
                <RNText
                  allowFontScaling={false}
                  style={[styles.rowMeta, { color: textTertiary }]}
                >
                  {t('fonts.off')}
                </RNText>
              )}
              <Feather
                name="chevron-right"
                size={16}
                color={textTertiary}
                style={{ marginLeft: 4 }}
              />
            </View>
          </Pressable>
        </View>
      </ScrollView>

      {/* Emoji picker — SlideUpSheet (same style as the post 3-dots menu) */}
      <SlideUpSheet visible={emojiModal} onClose={() => setEmojiModal(false)}>
        <Text variant="body" weight="semibold" align="center" style={{ paddingVertical: 8 }}>
          {t('fonts.emoji_modal_title')}
        </Text>
        <ScrollView
          style={{ maxHeight: 320 }}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 8 }}
        >
          <View style={styles.emojiGrid}>
            <Pressable
              onPress={() => pickEmoji('')}
              style={[
                styles.emojiCell,
                {
                  borderColor: activeEmoji === '' && !activePixelId ? theme.colors.accent.primary : borderLight,
                  backgroundColor:
                    activeEmoji === '' && !activePixelId ? theme.colors.accent.primary + '20' : 'transparent',
                },
              ]}
            >
              <Feather name="slash" size={16} color={textTertiary} />
            </Pressable>
            {PROFILE_EMOJI_CHOICES.map((e) => (
              <Pressable
                key={e}
                onPress={() => pickEmoji(e)}
                style={[
                  styles.emojiCell,
                  {
                    borderColor: activeEmoji === e ? theme.colors.accent.primary : borderLight,
                    backgroundColor:
                      activeEmoji === e ? theme.colors.accent.primary + '20' : 'transparent',
                  },
                ]}
              >
                <RNText style={styles.emojiCellText} allowFontScaling={false}>
                  {e}
                </RNText>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      </SlideUpSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  headerWrapper: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 8,
    position: 'relative',
  },
  headerBack: { position: 'absolute' },
  card: {
    borderRadius: 14,
    borderWidth: 0.5,
    overflow: 'hidden',
    marginTop: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  rowLabel: { fontSize: 15 },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: '60%',
  },
  rowMeta: { fontSize: 13, fontVariant: ['tabular-nums'] },
  emojiChip: { fontSize: 20 },
  emojiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },
  emojiCell: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  emojiCellText: { fontSize: 22 },
});
