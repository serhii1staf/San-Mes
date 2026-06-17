/**
 * Chat settings — card layout that mirrors app/settings/fonts.tsx.
 *
 * Same screen serves two flows, distinguished by the `id` route param:
 *   - Global / "all chats"  — id === GLOBAL_CHAT_SETTINGS_KEY
 *   - Per-chat              — id === <conversation id>
 *
 * Layout:
 *   1. Gradient header (back chevron + centered title)
 *   2. One grouped card listing the chat-flavoured settings as rows. Each
 *      row: 14px padding, 0.5px hairline divider, no bold labels, value +
 *      chevron on the right. Tapping a row opens a dedicated fullscreen
 *      modal (chat-background, chat-text-size, chat-bubble-radius,
 *      chat-font) — Telegram-style live preview + Apply / Cancel.
 *   3. The "Имя чата" row (per-chat only) and "Эмодзи ссылок" row stay
 *      inline as bottom-sheet editors — they're cheaper than a fullscreen
 *      modal and don't benefit from a chat-bubble preview.
 *   4. Bottom: "Сбросить настройки" — destructive accent that resets the
 *      chat-specific entry back to the inherited defaults.
 */

import React, { useState } from 'react';
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
import {
  useChatSettingsStore,
  GLOBAL_CHAT_SETTINGS_KEY,
} from '../../src/store/chatSettingsStore';
import { useEntityStore } from '../../src/store';
import { showToast } from '../../src/store/toastStore';
import { triggerHaptic } from '../../src/utils/haptics';
import { useT } from '../../src/i18n/store';

// Emoji choices for the "link preview emoji" row — same set as the legacy
// chat-settings screen so users get exactly the visual options they had
// before the redesign.
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

  // Subscribe to the store so the rows update live when a child modal
  // commits a change and pops back. Reading the whole `settings` map
  // intentionally — getSettings() is a method, not reactive on its own.
  const settings = useChatSettingsStore((s) => s.settings);
  const updateSettings = useChatSettingsStore((s) => s.updateSettings);
  const resetSettings = useChatSettingsStore((s) => s.resetSettings);
  const applied = useChatSettingsStore.getState().getSettings(chatId);
  // We force a re-read on every render via the `settings` subscription
  // above so the row metas always reflect the latest applied values.
  void settings;

  const conversations = useEntityStore((s) => s.conversations);
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

  // ── Theme tokens ───────────────────────────────────────────────────────
  const bgPrimary = theme.colors.background.primary;
  const bgElevated = theme.colors.background.elevated;
  const borderLight = theme.colors.border.light;
  const textPrimary = theme.colors.text.primary;
  const textSecondary = theme.colors.text.secondary;
  const textTertiary = theme.colors.text.tertiary;
  const accent = theme.colors.accent.primary;
  const danger = '#FF3B30';

  const headerContentHeight = insets.top + 48;
  const headerGradientHeight = headerContentHeight + 28;
  const bgTransparent = bgPrimary + '00';

  // ── Right-side metas for each row ──────────────────────────────────────
  const sizeMeta = `${applied.fontSize} pt`;
  const radiusMeta = `${applied.bubbleRadius}`;
  const fontMeta =
    applied.fontFamily === 'serif'
      ? t('chat_settings.font.serif')
      : applied.fontFamily === 'mono'
        ? t('chat_settings.font.mono')
        : t('chat_settings.font.system');
  const fontMetaPreviewFamily =
    applied.fontFamily === 'mono' ? 'monospace' : applied.fontFamily === 'serif' ? 'serif' : undefined;
  const bgMeta = applied.backgroundImage
    ? t('common.done') // shows a checkmark via icon below; meta string is a no-op
    : t('chat_settings.bg_none');
  const linkEmojiMeta = applied.linkEmoji ?? t('chat_settings.link_emoji_off');

  return (
    <View style={{ flex: 1, backgroundColor: bgPrimary }}>
      {/* ── Gradient header (matches fonts.tsx) ─────────────────────────── */}
      <View style={[styles.headerWrapper, { height: headerGradientHeight }]} pointerEvents="box-none">
        <LinearGradient
          colors={[bgPrimary, bgPrimary, bgTransparent]}
          locations={[0, 0.55, 1]}
          style={StyleSheet.absoluteFill}
        />
        <View style={[styles.headerRow, { paddingTop: insets.top + 8 }]} pointerEvents="auto">
          <Pressable
            onPress={() => router.back()}
            hitSlop={10}
            style={[styles.headerBack, { left: theme.spacing.lg, top: insets.top + 8 }]}
          >
            <Feather name="chevron-left" size={24} color={textPrimary} />
          </Pressable>
          <Text variant="subheading" weight="bold" numberOfLines={1}>
            {headerTitle}
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
        {/* ── Card 1: per-chat name (only for non-global flow) ────────── */}
        {!isGlobal && (
          <View style={[styles.card, { backgroundColor: bgElevated, borderColor: borderLight, marginTop: 8 }]}>
            <Pressable onPress={openNameSheet} style={styles.row}>
              <RNText allowFontScaling={false} style={[styles.rowLabel, { color: textPrimary }]}>
                {t('chat_settings.local_name')}
              </RNText>
              <View style={styles.rowRight}>
                <RNText
                  allowFontScaling={false}
                  style={[styles.rowMeta, { color: applied.localName ? textSecondary : textTertiary }]}
                  numberOfLines={1}
                >
                  {applied.localName || t('chat_settings.local_name_placeholder')}
                </RNText>
                <Feather name="chevron-right" size={16} color={textTertiary} style={{ marginLeft: 4 }} />
              </View>
            </Pressable>
          </View>
        )}

        {/* ── Card 2: visual settings — each row links to a fullscreen modal */}
        <View style={[styles.card, { backgroundColor: bgElevated, borderColor: borderLight, marginTop: 12 }]}>
          {/* Background */}
          <Pressable
            onPress={() => {
              triggerHaptic('selection');
              router.push({ pathname: '/settings/chat-background', params: { id: chatId } } as any);
            }}
            style={[styles.row, { borderBottomWidth: 0.5, borderBottomColor: borderLight }]}
          >
            <RNText allowFontScaling={false} style={[styles.rowLabel, { color: textPrimary }]}>
              {t('chat_settings.background')}
            </RNText>
            <View style={styles.rowRight}>
              {applied.backgroundImage ? (
                <Feather name="check-circle" size={16} color={accent} />
              ) : (
                <RNText allowFontScaling={false} style={[styles.rowMeta, { color: textTertiary }]} numberOfLines={1}>
                  {bgMeta}
                </RNText>
              )}
              <Feather name="chevron-right" size={16} color={textTertiary} style={{ marginLeft: 4 }} />
            </View>
          </Pressable>

          {/* Text size */}
          <Pressable
            onPress={() => {
              triggerHaptic('selection');
              router.push({ pathname: '/settings/chat-text-size', params: { id: chatId } } as any);
            }}
            style={[styles.row, { borderBottomWidth: 0.5, borderBottomColor: borderLight }]}
          >
            <RNText allowFontScaling={false} style={[styles.rowLabel, { color: textPrimary }]}>
              {t('chat_settings.font_size')}
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

          {/* Bubble radius */}
          <Pressable
            onPress={() => {
              triggerHaptic('selection');
              router.push({ pathname: '/settings/chat-bubble-radius', params: { id: chatId } } as any);
            }}
            style={[styles.row, { borderBottomWidth: 0.5, borderBottomColor: borderLight }]}
          >
            <RNText allowFontScaling={false} style={[styles.rowLabel, { color: textPrimary }]}>
              {t('chat_settings.bubble_radius')}
            </RNText>
            <View style={styles.rowRight}>
              <RNText
                allowFontScaling={false}
                style={[styles.rowMeta, { color: textTertiary }]}
                numberOfLines={1}
              >
                {radiusMeta}
              </RNText>
              <Feather name="chevron-right" size={16} color={textTertiary} style={{ marginLeft: 4 }} />
            </View>
          </Pressable>

          {/* Font family */}
          <Pressable
            onPress={() => {
              triggerHaptic('selection');
              router.push({ pathname: '/settings/chat-font', params: { id: chatId } } as any);
            }}
            style={[styles.row, { borderBottomWidth: 0.5, borderBottomColor: borderLight }]}
          >
            <RNText allowFontScaling={false} style={[styles.rowLabel, { color: textPrimary }]}>
              {t('chat_settings.font_family')}
            </RNText>
            <View style={styles.rowRight}>
              <RNText
                allowFontScaling={false}
                style={[
                  styles.rowMeta,
                  { color: textSecondary, fontFamily: fontMetaPreviewFamily },
                ]}
                numberOfLines={1}
              >
                {fontMeta}
              </RNText>
              <Feather name="chevron-right" size={16} color={textTertiary} style={{ marginLeft: 4 }} />
            </View>
          </Pressable>

          {/* Link emoji */}
          <Pressable onPress={openEmojiSheet} style={styles.row}>
            <RNText allowFontScaling={false} style={[styles.rowLabel, { color: textPrimary }]}>
              {t('chat_settings.link_emoji')}
            </RNText>
            <View style={styles.rowRight}>
              {applied.linkEmoji ? (
                <RNText style={styles.emojiChip} allowFontScaling={false}>
                  {applied.linkEmoji}
                </RNText>
              ) : (
                <RNText
                  allowFontScaling={false}
                  style={[styles.rowMeta, { color: textTertiary }]}
                >
                  {linkEmojiMeta}
                </RNText>
              )}
              <Feather name="chevron-right" size={16} color={textTertiary} style={{ marginLeft: 4 }} />
            </View>
          </Pressable>
        </View>

        {/* ── Card 3: behavior toggles ─────────────────────────────────── */}
        {/* Per-chat behaviour switches. Currently just the floating
            scroll-to-bottom affordance. Same merge chain as the other
            settings (defaults < global < specific) so toggling on the
            "all chats" row sets the app-wide default. */}
        <View style={[styles.card, { backgroundColor: bgElevated, borderColor: borderLight, marginTop: 12 }]}>
          <View style={[styles.row, { paddingVertical: 12 }]}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <RNText allowFontScaling={false} style={[styles.rowLabel, { color: textPrimary }]}>
                {t('chat_settings.scroll_button_title')}
              </RNText>
              <RNText
                allowFontScaling={false}
                style={[styles.rowMeta, { color: textTertiary, marginTop: 2 }]}
              >
                {t('chat_settings.scroll_button_subtitle')}
              </RNText>
            </View>
            <Switch
              value={applied.scrollToBottomButton}
              onValueChange={(v) => {
                triggerHaptic('selection');
                updateSettings(chatId, { scrollToBottomButton: v });
              }}
              trackColor={{ true: '#4CD964', false: borderLight }}
              thumbColor="#FFFFFF"
            />
          </View>
        </View>

        {/* ── Card 4: reset (destructive) ─────────────────────────────── */}
        <View style={[styles.card, { backgroundColor: bgElevated, borderColor: borderLight, marginTop: 24 }]}>
          <Pressable onPress={onReset} style={styles.row}>
            <RNText allowFontScaling={false} style={[styles.rowLabel, { color: danger }]}>
              {t('chat_settings.reset')}
            </RNText>
          </Pressable>
        </View>
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
    justifyContent: 'center',
    paddingBottom: 8,
    paddingHorizontal: 60, // leave room for the back chevron
    position: 'relative',
  },
  headerBack: { position: 'absolute' },
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
  emojiCellText: { fontSize: 22 },
});
