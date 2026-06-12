import React, { useState } from 'react';
import { View, Pressable, ScrollView, Modal, Text as RNText } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { useThemeStore, FONT_FAMILIES, FONT_SIZES } from '../../src/store/themeStore';
import { useProfileAppearanceStore } from '../../src/store/profileAppearanceStore';
import { SlideUpSheet } from '../../src/components/ui/SlideUpSheet';
import { useT } from '../../src/i18n/store';

const PROFILE_EMOJI_CHOICES = ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '⭐', '🌟', '✨', '💫', '🔥', '⚡', '🌈', '☀️', '🌙', '🌸', '🌺', '🌹', '🌻', '🌼', '🍀', '🌿', '🦋', '🐱', '🐶', '🐼', '🦊', '🐰', '🍑', '🍓', '🍉', '🍒', '🎵', '🎶', '🎨', '🎮', '👑', '😎', '🥰', '😇', '🤩', '💎', '🌊', '☕', '🍕', '⚽'];

export default function FontsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  const { fontFamily, fontSize, setFontFamily, setFontSize } = useThemeStore();
  const { postEmoji, setPostEmoji } = useProfileAppearanceStore();
  const [emojiModal, setEmojiModal] = useState(false);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingTop: insets.top + 8, paddingBottom: 16, position: 'relative' }}>
        <Pressable onPress={() => router.back()} style={{ position: 'absolute', left: 24, top: insets.top + 8 }}>
          <Feather name="chevron-left" size={24} color={theme.colors.text.primary} />
        </Pressable>
        <Text variant="body" weight="bold">{t('settings.fonts')}</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
        {/* Preview */}
        <View style={{ backgroundColor: theme.colors.background.elevated, borderRadius: 20, padding: 20, marginBottom: 28, borderWidth: 1, borderColor: theme.colors.border.light }}>
          <Text variant="body" weight="bold" style={{ marginBottom: 8 }}>{t('fonts.preview.hello')}</Text>
          <Text variant="body" color={theme.colors.text.secondary} style={{ marginBottom: 12 }}>{t('fonts.preview.body')}</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1, backgroundColor: theme.colors.accent.primary + '15', borderRadius: 12, padding: 10 }}>
              <Text variant="caption" weight="semibold" color={theme.colors.accent.primary}>{t('fonts.preview.heading')}</Text>
              <Text variant="caption" color={theme.colors.text.tertiary} style={{ marginTop: 2 }}>{t('fonts.preview.subheading')}</Text>
            </View>
            <View style={{ flex: 1, backgroundColor: theme.colors.background.secondary, borderRadius: 12, padding: 10 }}>
              <Text variant="caption" weight="medium">12:30</Text>
              <Text variant="caption" color={theme.colors.text.tertiary} style={{ marginTop: 2 }}>{t('fonts.preview.message')}</Text>
            </View>
          </View>
        </View>

        {/* Font Size */}
        <Text variant="caption" weight="semibold" color={theme.colors.text.secondary} style={{ marginBottom: 12 }}>{t('fonts.size_label')}</Text>
        <View style={{ gap: 8, marginBottom: 28 }}>
          {FONT_SIZES.map(f => (
            <Pressable
              key={f.key}
              onPress={() => setFontSize(f.key)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingVertical: 14,
                paddingHorizontal: 16,
                borderRadius: 14,
                backgroundColor: fontSize === f.key ? theme.colors.accent.primary + '15' : theme.colors.background.elevated,
                borderWidth: fontSize === f.key ? 1.5 : 0,
                borderColor: theme.colors.accent.primary,
              }}
            >
              <Text variant="body" weight={fontSize === f.key ? 'semibold' : 'regular'} color={fontSize === f.key ? theme.colors.accent.primary : theme.colors.text.primary}>
                {t(`font.size.${f.key}`, f.label)}
              </Text>
              <Text variant="caption" color={theme.colors.text.tertiary}>{Math.round(f.scale * 100)}%</Text>
            </Pressable>
          ))}
        </View>

        {/* Font Family */}
        <Text variant="caption" weight="semibold" color={theme.colors.text.secondary} style={{ marginBottom: 12 }}>{t('fonts.family_label')}</Text>
        <View style={{ gap: 8 }}>
          {FONT_FAMILIES.map(f => (
            <Pressable
              key={f.key}
              onPress={() => setFontFamily(f.key)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingVertical: 14,
                paddingHorizontal: 16,
                borderRadius: 14,
                backgroundColor: fontFamily === f.key ? theme.colors.accent.primary + '15' : theme.colors.background.elevated,
                borderWidth: fontFamily === f.key ? 1.5 : 0,
                borderColor: theme.colors.accent.primary,
              }}
            >
              <Text variant="body" weight={fontFamily === f.key ? 'semibold' : 'regular'} color={fontFamily === f.key ? theme.colors.accent.primary : theme.colors.text.primary}>
                {f.key === 'system' ? t('font.family.system', f.label) : f.label}
              </Text>
              {fontFamily === f.key && <Feather name="check" size={18} color={theme.colors.accent.primary} />}
            </Pressable>
          ))}
        </View>

        {/* Profile card emoji */}
        <Text variant="caption" weight="semibold" color={theme.colors.text.secondary} style={{ marginTop: 28, marginBottom: 12 }}>{t('fonts.emoji_label')}</Text>
        <Pressable
          onPress={() => setEmojiModal(true)}
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, paddingHorizontal: 16, borderRadius: 14, backgroundColor: theme.colors.background.elevated }}
        >
          <Text variant="body">{t('fonts.decorative_emoji')}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {postEmoji
              ? <RNText style={{ fontSize: 20 }} allowFontScaling={false}>{postEmoji}</RNText>
              : <Text variant="caption" color={theme.colors.text.tertiary}>{t('fonts.off')}</Text>}
            <Feather name="chevron-right" size={18} color={theme.colors.text.tertiary} />
          </View>
        </Pressable>
      </ScrollView>

      {/* Emoji picker — same sheet style as the feed three-dots menu */}
      <SlideUpSheet visible={emojiModal} onClose={() => setEmojiModal(false)}>
        <Text variant="body" weight="bold" align="center" style={{ marginBottom: 12 }}>{t('fonts.emoji_modal_title')}</Text>
        <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 4 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10 }}>
            <Pressable onPress={() => { setPostEmoji(''); setEmojiModal(false); }} style={{ width: 50, height: 50, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: postEmoji === '' ? theme.colors.accent.primary : theme.colors.border.light, backgroundColor: postEmoji === '' ? theme.colors.accent.primary + '15' : 'transparent' }}>
              <Feather name="slash" size={18} color={theme.colors.text.tertiary} />
            </Pressable>
            {PROFILE_EMOJI_CHOICES.map((e) => (
              <Pressable key={e} onPress={() => { setPostEmoji(e); setEmojiModal(false); }} style={{ width: 50, height: 50, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: postEmoji === e ? theme.colors.accent.primary : theme.colors.border.light, backgroundColor: postEmoji === e ? theme.colors.accent.primary + '15' : 'transparent' }}>
                <RNText style={{ fontSize: 26 }} allowFontScaling={false}>{e}</RNText>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      </SlideUpSheet>
    </View>
  );
}
