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

// Inline-preview font for each family option. Mirrors the regular weight
// ThemeProvider builds, so each row's label renders in the family the
// user is about to switch to.
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
  const { fontFamily, fontSize, setFontFamily, setFontSize } = useThemeStore();
  const { postEmoji, setPostEmoji } = useProfileAppearanceStore();
  const [emojiModal, setEmojiModal] = useState(false);

  const bgPrimary = theme.colors.background.primary;
  const bgElevated = theme.colors.background.elevated;
  const bgSecondary = theme.colors.background.secondary;
  const borderLight = theme.colors.border.light;
  const accent = theme.colors.accent.primary;
  const textPrimary = theme.colors.text.primary;
  const textSecondary = theme.colors.text.secondary;
  const textTertiary = theme.colors.text.tertiary;

  const headerContentHeight = insets.top + 48;
  const headerGradientHeight = headerContentHeight + 28;
  const bgTransparent = bgPrimary + '00';

  const chooseSize = (key: typeof FONT_SIZES[number]['key']) => {
    if (fontSize === key) return;
    triggerHaptic('selection');
    setFontSize(key);
  };

  const chooseFamily = (key: FontFamily) => {
    if (fontFamily === key) return;
    triggerHaptic('selection');
    setFontFamily(key);
  };

  const openEmojiSheet = () => {
    triggerHaptic('selection');
    setEmojiModal(true);
  };

  const pickEmoji = (value: string) => {
    triggerHaptic('selection');
    setPostEmoji(value);
    setEmojiModal(false);
  };

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
        {/* ── Размер шрифта ──────────────────────────────────────────── */}
        <Text style={[styles.sectionLabel, { color: textSecondary }]}>
          {t('fonts.size_label').toUpperCase()}
        </Text>
        <View style={[styles.card, { backgroundColor: bgElevated, borderColor: borderLight }]}>
          {FONT_SIZES.map((f, i) => {
            const active = fontSize === f.key;
            const last = i === FONT_SIZES.length - 1;
            return (
              <Pressable
                key={f.key}
                onPress={() => chooseSize(f.key)}
                style={[
                  styles.row,
                  !last && { borderBottomWidth: 0.5, borderBottomColor: borderLight },
                ]}
              >
                <RNText
                  allowFontScaling={false}
                  style={[
                    styles.rowLabel,
                    { color: active ? accent : textPrimary, fontWeight: active ? '600' : '400' },
                  ]}
                >
                  {t(`font.size.${f.key}`, f.label)}
                </RNText>
                <View style={styles.rowRight}>
                  <RNText
                    allowFontScaling={false}
                    style={[styles.rowMeta, { color: active ? accent : textTertiary }]}
                  >
                    {Math.round(f.scale * 100)}%
                  </RNText>
                  {active && <Feather name="check" size={16} color={accent} style={{ marginLeft: 8 }} />}
                </View>
              </Pressable>
            );
          })}
        </View>

        {/* ── Шрифт ──────────────────────────────────────────────────── */}
        <Text style={[styles.sectionLabel, { color: textSecondary }]}>
          {t('fonts.family_label').toUpperCase()}
        </Text>
        <View style={[styles.card, { backgroundColor: bgElevated, borderColor: borderLight }]}>
          {FONT_FAMILIES.map((f, i) => {
            const active = fontFamily === f.key;
            const last = i === FONT_FAMILIES.length - 1;
            const previewFont = FAMILY_PREVIEW_FONT[f.key];
            const label = f.key === 'system' ? t('font.family.system', f.label) : f.label;
            return (
              <Pressable
                key={f.key}
                onPress={() => chooseFamily(f.key)}
                style={[
                  styles.row,
                  !last && { borderBottomWidth: 0.5, borderBottomColor: borderLight },
                ]}
              >
                <RNText
                  allowFontScaling={false}
                  style={[
                    styles.rowLabel,
                    {
                      color: active ? accent : textPrimary,
                      fontFamily: previewFont,
                      fontWeight: active ? '600' : '400',
                    },
                  ]}
                >
                  {label}
                </RNText>
                {active && <Feather name="check" size={16} color={accent} />}
              </Pressable>
            );
          })}
        </View>

        {/* ── Декоративный эмодзи ────────────────────────────────────── */}
        <Text style={[styles.sectionLabel, { color: textSecondary }]}>
          {t('fonts.emoji_label').toUpperCase()}
        </Text>
        <View style={[styles.card, { backgroundColor: bgElevated, borderColor: borderLight }]}>
          <Pressable onPress={openEmojiSheet} style={styles.row}>
            <RNText allowFontScaling={false} style={[styles.rowLabel, { color: textPrimary }]}>
              {t('fonts.decorative_emoji')}
            </RNText>
            <View style={styles.rowRight}>
              {postEmoji ? (
                <RNText style={styles.emojiChip} allowFontScaling={false}>
                  {postEmoji}
                </RNText>
              ) : (
                <RNText
                  allowFontScaling={false}
                  style={[styles.rowMeta, { color: textTertiary }]}
                >
                  {t('fonts.off')}
                </RNText>
              )}
              <Feather name="chevron-right" size={16} color={textTertiary} style={{ marginLeft: 4 }} />
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
                  borderColor: postEmoji === '' ? accent : borderLight,
                  backgroundColor: postEmoji === '' ? accent + '20' : 'transparent',
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
                    borderColor: postEmoji === e ? accent : borderLight,
                    backgroundColor: postEmoji === e ? accent + '20' : 'transparent',
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
  sectionLabel: {
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.6,
    marginTop: 16,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  card: {
    borderRadius: 14,
    borderWidth: 0.5,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  rowLabel: { fontSize: 15 },
  rowRight: { flexDirection: 'row', alignItems: 'center' },
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
