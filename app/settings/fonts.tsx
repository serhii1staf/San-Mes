import React from 'react';
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
import { triggerHaptic } from '../../src/utils/haptics';
import { useT } from '../../src/i18n/store';
import { headerScrimHeights } from '../../src/theme/scrim';

// Inline-preview font for each family option. Mirrors the regular weight
// ThemeProvider builds, so the right-side font label renders in the family
// the user is currently using.
const FAMILY_PREVIEW_FONT: Record<FontFamily, string> = {
  inter: 'Inter_400Regular',
  system: 'System',
  serif: 'Georgia',
  mono: 'Courier',
};

/**
 * Text size and font family, each opening its own preview screen (Telegram-style index).
 *
 * The "decorative emoji" and "Pixel icons" rows that used to sit here decorated POST CARDS
 * (a faint pattern behind every card). Posts were removed, so both rows went with them.
 */
export default function FontsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  const fontFamily = useThemeStore((s) => s.fontFamily);
  const fontSize = useThemeStore((s) => s.fontSize);

  const bgPrimary = theme.colors.background.primary;
  const bgElevated = theme.colors.background.elevated;
  const borderLight = theme.colors.border.light;
  const textPrimary = theme.colors.text.primary;
  const textSecondary = theme.colors.text.secondary;
  const textTertiary = theme.colors.text.tertiary;

  const { content: headerContentHeight, gradient: headerGradientHeight } = headerScrimHeights(insets.top);
  const bgTransparent = bgPrimary + '00';

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
              <Feather name="chevron-right" size={16} color={textTertiary} style={{ marginLeft: 4 }} />
            </View>
          </Pressable>

          {/* ── Шрифт ────────────────────────────────────────────── */}
          <Pressable onPress={openFamily} style={styles.row}>
            <RNText allowFontScaling={false} style={[styles.rowLabel, { color: textPrimary }]}>
              {t('fonts.font_title')}
            </RNText>
            <View style={styles.rowRight}>
              <RNText
                allowFontScaling={false}
                style={[styles.rowMeta, { color: textSecondary, fontFamily: familyPreviewFont }]}
                numberOfLines={1}
              >
                {familyMeta}
              </RNText>
              <Feather name="chevron-right" size={16} color={textTertiary} style={{ marginLeft: 4 }} />
            </View>
          </Pressable>
        </View>
      </ScrollView>
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
});
