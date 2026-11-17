/**
 * Chat settings.
 *
 * Same screen serves two flows, distinguished by the `id` route param:
 *   - Global / "all chats"  — id === GLOBAL_CHAT_SETTINGS_KEY
 *   - Per-chat              — id === <conversation id>
 *
 * Layout: a live chat preview on top (it follows every change made in the modals below), then grouped
 * cards built from the shared settings rows — the same icon tiles and geometry as the settings root,
 * so this screen no longer looks like a different app. Each look row opens its full-screen modal
 * (chat-background, chat-text-size, chat-bubble-radius, chat-bubble-color, chat-font); the chat name
 * (per-chat only) and the link emoji stay inline as bottom sheets.
 */

import React, { useMemo, useState } from 'react';
import {
  View,
  Pressable,
  ScrollView,
  StyleSheet,
  Text as RNText,
  TextInput,
  Alert,
  Switch,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../src/theme';
import { Text } from '../../src/components/ui';
import { SlideUpSheet } from '../../src/components/ui/SlideUpSheet';
import { ChatPreviewBubbles } from '../../src/components/ui/ChatPreviewBubbles';
import { SettingsRow, SettingsSection } from '../../src/components/settings/SettingsList';
import {
  useChatSettingsStore,
  GLOBAL_CHAT_SETTINGS_KEY,
} from '../../src/store/chatSettingsStore';
import { useEntityStore } from '../../src/store';
import { useSettingsStore } from '../../src/store/settingsStore';
import { readableTextOn } from '../../src/constants/bubbleColors';
import { showToast } from '../../src/store/toastStore';
import { triggerHaptic } from '../../src/utils/haptics';
import { useT } from '../../src/i18n/store';
import { headerScrimHeights, SCRIM_LOCATIONS, topScrimColors } from '../../src/theme/scrim';
import { emojiTextStyle } from '../../src/components/ui/emojiText';

// Emoji choices for the "link preview emoji" row.
const LINK_EMOJI_CHOICES = [
  '❤️', '😍', '🔥', '⭐', '🌸', '😎', '🎵', '⚽',
  '🎮', '🍕', '🚀', '💎', '🌙', '☀️', '🐱', '🎁',
];

export default function ChatSettingsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const chatId = id || GLOBAL_CHAT_SETTINGS_KEY;
  const isGlobal = chatId === GLOBAL_CHAT_SETTINGS_KEY;

  // Subscribe to the store so the rows update live when a child modal commits a change and pops back.
  // `getSettings()` is a method, not reactive on its own.
  const settings = useChatSettingsStore((s) => s.settings);
  const updateSettings = useChatSettingsStore((s) => s.updateSettings);
  const resetSettings = useChatSettingsStore((s) => s.resetSettings);
  const applied = useMemo(
    () => useChatSettingsStore.getState().getSettings(chatId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings, chatId],
  );

  const conversations = useEntityStore((s) => s.conversations);
  // App-wide message colours (null = follow the theme accent / neutral surface).
  const chatBubble = useSettingsStore((s) => s.chatBubble);
  const chatBubbleIn = useSettingsStore((s) => s.chatBubbleIn);
  const conv = conversations.find((c) => c.id === chatId);
  const headerTitle = isGlobal
    ? t('chat_settings.all_chats')
    : conv?.participantName || t('chat_settings.title');

  // ── Inline editors (bottom sheets) ─────────────────────────────────────
  const [nameSheet, setNameSheet] = useState(false);
  const [emojiSheet, setEmojiSheet] = useState(false);
  const [draftName, setDraftName] = useState(applied.localName || '');

  const openNameSheet = () => {
    triggerHaptic('selection');
    setDraftName(applied.localName || '');
    setNameSheet(true);
  };
  const saveName = () => {
    triggerHaptic('medium');
    const next = draftName.trim();
    updateSettings(chatId, { localName: next || undefined });
    setNameSheet(false);
  };

  const openEmojiSheet = () => {
    triggerHaptic('selection');
    setEmojiSheet(true);
  };
  const pickEmoji = (value: string | undefined) => {
    triggerHaptic('selection');
    updateSettings(chatId, { linkEmoji: value });
  };

  // ── Reset ──────────────────────────────────────────────────────────────
  const onReset = () => {
    Alert.alert(
      t('chat_settings.reset_confirm_title'),
      t('chat_settings.reset_confirm_msg'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('chat_settings.reset'),
          style: 'destructive',
          onPress: () => {
            triggerHaptic('medium');
            resetSettings(chatId);
            showToast(t('chat_settings.toast.reset'), 'check');
          },
        },
      ],
    );
  };

  const open = (pathname: string, withId = true) => {
    triggerHaptic('selection');
    router.push((withId ? { pathname, params: { id: chatId } } : pathname) as any);
  };

  // ── Theme tokens ───────────────────────────────────────────────────────
  const bgPrimary = theme.colors.background.primary;
  const borderLight = theme.colors.border.light;
  const textPrimary = theme.colors.text.primary;
  const textTertiary = theme.colors.text.tertiary;
  const accent = theme.colors.accent.primary;

  const { content: headerContentHeight, gradient: headerGradientHeight } = headerScrimHeights(insets.top);

  // ── Right-side values ──────────────────────────────────────────────────
  const fontMeta =
    applied.fontFamily === 'serif'
      ? t('chat_settings.font.serif')
      : applied.fontFamily === 'mono'
        ? t('chat_settings.font.mono')
        : t('chat_settings.font.system');
  const previewFamily =
    applied.fontFamily === 'mono' ? 'monospace' : applied.fontFamily === 'serif' ? 'serif' : undefined;
  const outText = chatBubble && chatBubble.colors.length > 0 ? readableTextOn(chatBubble.colors) : undefined;
  const inText = chatBubbleIn && chatBubbleIn.colors.length > 0 ? readableTextOn(chatBubbleIn.colors) : undefined;
  const bubbleSwatch =
    chatBubble && chatBubble.colors.length > 1 ? (
      <LinearGradient
        colors={chatBubble.colors as any}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.swatch, { borderColor: borderLight }]}
      />
    ) : (
      <View style={[styles.swatch, { borderColor: borderLight, backgroundColor: (chatBubble && chatBubble.colors[0]) || accent }]} />
    );

  return (
    <View style={{ flex: 1, backgroundColor: bgPrimary }}>
      <View style={[styles.headerWrapper, { height: headerGradientHeight }]} pointerEvents="box-none">
        <LinearGradient
          colors={topScrimColors(theme.isDark, bgPrimary)}
          locations={SCRIM_LOCATIONS}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <View style={[styles.headerRow, { paddingTop: insets.top + 8 }]}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={styles.headerSide} accessibilityRole="button" accessibilityLabel={t('common.back')}>
            <Feather name="chevron-left" size={26} color={textPrimary} />
          </Pressable>
          <Text variant="subheading" weight="bold" numberOfLines={1} style={{ flexShrink: 1 }}>
            {headerTitle}
          </Text>
          <View style={styles.headerSide} />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: headerContentHeight + 8,
          paddingBottom: insets.bottom + 60,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Live preview of exactly what these settings produce. */}
        <View style={[styles.preview, { borderColor: borderLight }]}>
          <ChatPreviewBubbles
            height={262}
            fontSize={applied.fontSize}
            fontFamily={previewFamily}
            bubbleRadius={applied.bubbleRadius}
            backgroundImage={applied.backgroundImage}
            topPadding={12}
            bubbleColors={chatBubble?.colors}
            bubbleOpacity={chatBubble?.opacity}
            bubbleTextColor={outText}
            inColors={chatBubbleIn?.colors}
            inOpacity={chatBubbleIn?.opacity}
            inTextColor={inText}
          />
        </View>

        {!isGlobal && (
          <SettingsSection>
            <SettingsRow
              icon="badge"
              iconTint="gray"
              label={t('chat_settings.local_name')}
              value={applied.localName || t('chat_settings.local_name_placeholder')}
              onPress={openNameSheet}
              isLast
            />
          </SettingsSection>
        )}

        <SettingsSection title={t('appearance.chats')}>
          <SettingsRow
            icon="wallpaper"
            iconTint="teal"
            label={t('chat_settings.background')}
            value={applied.backgroundImage ? undefined : t('chat_settings.bg_none')}
            valueNode={applied.backgroundImage ? <Feather name="check-circle" size={16} color={accent} /> : undefined}
            onPress={() => open('/settings/chat-background')}
          />
          <SettingsRow
            icon="format-color-fill"
            iconTint="pink"
            label={t('chat_settings.message_color', 'Цвет сообщений')}
            valueNode={bubbleSwatch}
            onPress={() => open('/settings/chat-bubble-color', false)}
          />
          <SettingsRow
            icon="rounded-corner"
            iconTint="indigo"
            label={t('chat_settings.bubble_radius')}
            value={String(applied.bubbleRadius)}
            onPress={() => open('/settings/chat-bubble-radius')}
          />
          <SettingsRow
            icon="format-size"
            iconTint="orange"
            label={t('chat_settings.font_size')}
            value={`${applied.fontSize} pt`}
            onPress={() => open('/settings/chat-text-size')}
          />
          <SettingsRow
            icon="font-download"
            iconTint="purple"
            label={t('chat_settings.font_family')}
            value={fontMeta}
            onPress={() => open('/settings/chat-font')}
          />
          <SettingsRow
            icon="link"
            iconTint="blue"
            label={t('chat_settings.link_emoji')}
            value={applied.linkEmoji ? undefined : t('chat_settings.link_emoji_off')}
            valueNode={applied.linkEmoji ? <RNText style={styles.emojiChip} allowFontScaling={false}>{applied.linkEmoji}</RNText> : undefined}
            onPress={openEmojiSheet}
            isLast
          />
        </SettingsSection>

        <SettingsSection footer={t('chat_settings.scroll_button_subtitle')}>
          <SettingsRow
            icon="keyboard-double-arrow-down"
            iconTint="green"
            label={t('chat_settings.scroll_button_title')}
            showChevron={false}
            rightElement={
              <Switch
                value={applied.scrollToBottomButton}
                onValueChange={(v) => {
                  triggerHaptic('selection');
                  updateSettings(chatId, { scrollToBottomButton: v });
                }}
                trackColor={{ true: '#4CD964', false: borderLight }}
                thumbColor="#FFFFFF"
              />
            }
            isLast
          />
        </SettingsSection>

        <SettingsSection>
          <SettingsRow icon="restart-alt" iconTint="red" label={t('chat_settings.reset')} onPress={onReset} showChevron={false} destructive isLast />
        </SettingsSection>
      </ScrollView>

      {/* ── Local name editor (bottom sheet) ────────────────────────────── */}
      <SlideUpSheet visible={nameSheet} onClose={() => setNameSheet(false)}>
        <Text variant="body" weight="semibold" align="center" style={{ paddingVertical: 8 }}>
          {t('chat_settings.local_name')}
        </Text>
        <View style={{ paddingHorizontal: 14, paddingBottom: 14 }}>
          <TextInput
            value={draftName}
            onChangeText={setDraftName}
            placeholder={t('chat_settings.local_name_placeholder')}
            placeholderTextColor={textTertiary}
            autoFocus
            maxLength={64}
            style={{
              fontSize: 15,
              color: textPrimary,
              backgroundColor: theme.colors.background.primary,
              borderRadius: 12,
              borderWidth: 0.5,
              borderColor: borderLight,
              paddingHorizontal: 14,
              paddingVertical: 12,
              marginBottom: 10,
            }}
          />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable
              onPress={() => setNameSheet(false)}
              style={[styles.sheetBtn, { backgroundColor: theme.colors.background.primary, borderColor: borderLight }]}
            >
              <RNText allowFontScaling={false} style={[styles.sheetBtnText, { color: textPrimary }]}>
                {t('common.cancel')}
              </RNText>
            </Pressable>
            <Pressable
              onPress={saveName}
              style={[styles.sheetBtn, { backgroundColor: accent, borderColor: accent }]}
            >
              <RNText allowFontScaling={false} style={[styles.sheetBtnText, { color: '#FFFFFF' }]}>
                {t('common.apply')}
              </RNText>
            </Pressable>
          </View>
        </View>
      </SlideUpSheet>

      {/* ── Link emoji picker (bottom sheet) ────────────────────────────── */}
      <SlideUpSheet visible={emojiSheet} onClose={() => setEmojiSheet(false)}>
        <Text variant="body" weight="semibold" align="center" style={{ paddingVertical: 8 }}>
          {t('chat_settings.link_emoji')}
        </Text>
        <ScrollView
          style={{ maxHeight: 320 }}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 8 }}
        >
          <View style={styles.emojiGrid}>
            {/* "Off" tile — clears the link emoji */}
            <Pressable
              onPress={() => pickEmoji(undefined)}
              style={[
                styles.emojiCell,
                {
                  borderColor: !applied.linkEmoji ? accent : borderLight,
                  backgroundColor: !applied.linkEmoji ? accent + '20' : 'transparent',
                },
              ]}
            >
              <Feather name="slash" size={16} color={textTertiary} />
            </Pressable>
            {LINK_EMOJI_CHOICES.map((e) => (
              <Pressable
                key={e}
                onPress={() => pickEmoji(e)}
                style={[
                  styles.emojiCell,
                  {
                    borderColor: applied.linkEmoji === e ? accent : borderLight,
                    backgroundColor: applied.linkEmoji === e ? accent + '20' : 'transparent',
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
    justifyContent: 'space-between',
    paddingBottom: 8,
    paddingHorizontal: 12,
  },
  headerSide: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  preview: {
    marginBottom: 20,
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  swatch: { width: 22, height: 22, borderRadius: 11, borderWidth: StyleSheet.hairlineWidth },
  emojiChip: emojiTextStyle(20),
  // Bottom sheet helpers
  sheetBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0.5,
  },
  sheetBtnText: { fontSize: 15, fontWeight: '600' },
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
  emojiCellText: emojiTextStyle(22),
});
