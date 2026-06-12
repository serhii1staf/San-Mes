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
// of the map ThemeProvider builds, so each pill is rendered in the
// family the user is about to switch to.
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

  // Header sized to mirror settings/index.tsx so the back+title pair lands
  // in the exact same position across every settings sub-screen.
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

  // Reusable card shell — tinted bordered box, matches edit-profile cards.
  const cardStyle = {
    backgroundColor: bgElevated,
    borderRadius: 18,
    borderWidth: 0.5 as const,
    borderColor: borderLight,
    padding: 16,
    marginBottom: 20,
  };

  return (
    <View style={{ flex: 1, backgroundColor: bgPrimary }}>
      {/* Gradient header — same fade pattern as settings/index.tsx so the
          screen feels like a peer of the other settings sub-screens. */}
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 100,
          height: headerGradientHeight,
        }}
        pointerEvents="box-none"
      >
        <LinearGradient
          colors={[bgPrimary, bgPrimary, bgTransparent]}
          locations={[0, 0.55, 1]}
          style={StyleSheet.absoluteFill}
        />
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: theme.spacing.lg,
            paddingTop: insets.top + 8,
            paddingBottom: 8,
            position: 'relative',
          }}
          pointerEvents="auto"
        >
          <Pressable
            onPress={() => router.back()}
            hitSlop={10}
            style={{ position: 'absolute', left: theme.spacing.lg, top: insets.top + 8 }}
          >
            <Feather name="chevron-left" size={24} color={theme.colors.text.primary} />
          </Pressable>
          <Text variant="subheading" weight="bold">{t('settings.fonts')}</Text>
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
        {/* ── Font size card ───────────────────────────────────────────────
            Live preview sits at the top of this card — the user sees the
            heading/body/caption sample re-render as they tap a size or
            switch families, since Text already reads fontScale/fontFamily
            from the theme. */}
        <Text
          variant="caption"
          weight="semibold"
          color={theme.colors.text.secondary}
          style={{ marginBottom: 8, paddingHorizontal: 4 }}
        >
          {t('fonts.size_label')}
        </Text>
        <View style={cardStyle}>
          {/* Live preview surface */}
          <View
            style={{
              backgroundColor: bgSecondary,
              borderRadius: 14,
              padding: 16,
              marginBottom: 14,
            }}
          >
            <Text variant="subheading" weight="bold" style={{ marginBottom: 6 }}>
              {t('fonts.preview.heading')}
            </Text>
            <Text
              variant="body"
              color={theme.colors.text.secondary}
              style={{ marginBottom: 8 }}
            >
              {t('fonts.preview.body')}
            </Text>
            <Text variant="caption" color={theme.colors.text.tertiary}>
              {t('fonts.preview.subheading')}
            </Text>
          </View>

          {/* Size pills */}
          <View style={{ gap: 8 }}>
            {FONT_SIZES.map((f) => {
              const active = fontSize === f.key;
              return (
                <Pressable
                  key={f.key}
                  onPress={() => chooseSize(f.key)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingVertical: 14,
                    paddingHorizontal: 14,
                    borderRadius: 12,
                    backgroundColor: active ? accent + '20' : bgSecondary,
                    borderWidth: active ? 1.5 : 0,
                    borderColor: active ? accent : 'transparent',
                  }}
                >
                  <Text
                    variant="body"
                    weight={active ? 'semibold' : 'medium'}
                    color={active ? accent : theme.colors.text.primary}
                  >
                    {t(`font.size.${f.key}`, f.label)}
                  </Text>
                  <Text
                    variant="caption"
                    color={active ? accent : theme.colors.text.tertiary}
                    weight={active ? 'semibold' : 'regular'}
                  >
                    {Math.round(f.scale * 100)}%
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* ── Font family card ─────────────────────────────────────────────
            Each option's label is rendered IN the family it represents so
            the user previews the silhouette of every typeface inline
            without having to commit first. */}
        <Text
          variant="caption"
          weight="semibold"
          color={theme.colors.text.secondary}
          style={{ marginBottom: 8, paddingHorizontal: 4 }}
        >
          {t('fonts.family_label')}
        </Text>
        <View style={cardStyle}>
          <View style={{ gap: 8 }}>
            {FONT_FAMILIES.map((f) => {
              const active = fontFamily === f.key;
              const previewFont = FAMILY_PREVIEW_FONT[f.key];
              const label = f.key === 'system' ? t('font.family.system', f.label) : f.label;
              return (
                <Pressable
                  key={f.key}
                  onPress={() => chooseFamily(f.key)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingVertical: 14,
                    paddingHorizontal: 14,
                    borderRadius: 12,
                    backgroundColor: active ? accent + '20' : bgSecondary,
                    borderWidth: active ? 1.5 : 0,
                    borderColor: active ? accent : 'transparent',
                    gap: 12,
                  }}
                >
                  {/* "Aa" tile rendered in the option's own font */}
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 10,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: active ? accent + '25' : bgPrimary,
                    }}
                  >
                    <RNText
                      allowFontScaling={false}
                      style={{
                        fontFamily: previewFont,
                        fontSize: 18,
                        color: active ? accent : theme.colors.text.primary,
                        fontWeight: '600',
                      }}
                    >
                      {f.preview}
                    </RNText>
                  </View>
                  <RNText
                    allowFontScaling={false}
                    style={{
                      flex: 1,
                      fontFamily: previewFont,
                      fontSize: 16,
                      color: active ? accent : theme.colors.text.primary,
                      fontWeight: active ? '600' : '500',
                    }}
                  >
                    {label}
                  </RNText>
                  {active && <Feather name="check" size={18} color={accent} />}
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* ── Decorative emoji card ────────────────────────────────────────
            Single row that opens the SlideUpSheet — sheet itself is
            untouched, just the trigger row is wrapped in the modern
            card+pill treatment. */}
        <Text
          variant="caption"
          weight="semibold"
          color={theme.colors.text.secondary}
          style={{ marginBottom: 8, paddingHorizontal: 4 }}
        >
          {t('fonts.emoji_label')}
        </Text>
        <View style={cardStyle}>
          <Pressable
            onPress={openEmojiSheet}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingVertical: 14,
              paddingHorizontal: 14,
              borderRadius: 12,
              backgroundColor: bgSecondary,
            }}
          >
            <Text variant="body" weight="medium">
              {t('fonts.decorative_emoji')}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              {postEmoji ? (
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: bgPrimary,
                  }}
                >
                  <RNText style={{ fontSize: 20 }} allowFontScaling={false}>
                    {postEmoji}
                  </RNText>
                </View>
              ) : (
                <Text variant="caption" color={theme.colors.text.tertiary}>
                  {t('fonts.off')}
                </Text>
              )}
              <Feather name="chevron-right" size={18} color={theme.colors.text.tertiary} />
            </View>
          </Pressable>
        </View>
      </ScrollView>

      {/* Emoji picker — same SlideUpSheet as before, behavior untouched. */}
      <SlideUpSheet visible={emojiModal} onClose={() => setEmojiModal(false)}>
        <Text variant="body" weight="bold" align="center" style={{ marginBottom: 12 }}>
          {t('fonts.emoji_modal_title')}
        </Text>
        <ScrollView
          style={{ maxHeight: 320 }}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 4 }}
        >
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10 }}>
            <Pressable
              onPress={() => pickEmoji('')}
              style={{
                width: 50,
                height: 50,
                borderRadius: 16,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 1.5,
                borderColor: postEmoji === '' ? accent : borderLight,
                backgroundColor: postEmoji === '' ? accent + '20' : 'transparent',
              }}
            >
              <Feather name="slash" size={18} color={theme.colors.text.tertiary} />
            </Pressable>
            {PROFILE_EMOJI_CHOICES.map((e) => (
              <Pressable
                key={e}
                onPress={() => pickEmoji(e)}
                style={{
                  width: 50,
                  height: 50,
                  borderRadius: 16,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 1.5,
                  borderColor: postEmoji === e ? accent : borderLight,
                  backgroundColor: postEmoji === e ? accent + '20' : 'transparent',
                }}
              >
                <RNText style={{ fontSize: 26 }} allowFontScaling={false}>
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
