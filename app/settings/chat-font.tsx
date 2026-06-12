/**
 * Telegram-style fullscreen "Chat font" preview modal.
 *
 * Mirrors app/settings/fonts-family.tsx but drives the chat-specific
 * fontFamily field on chatSettingsStore. The chat font enum is smaller —
 * we only support the three styles MessageBubble actually maps to:
 * system / serif / mono.
 */

import React, { useState, useMemo } from 'react';
import {
  View,
  Pressable,
  StyleSheet,
  Text as RNText,
  ScrollView,
  Dimensions,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { useTheme } from '../../src/theme';
import { ChatPreviewBubbles } from '../../src/components/ui/ChatPreviewBubbles';
import {
  useChatSettingsStore,
  GLOBAL_CHAT_SETTINGS_KEY,
} from '../../src/store/chatSettingsStore';
import { triggerHaptic } from '../../src/utils/haptics';
import { useT } from '../../src/i18n/store';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const PREVIEW_HEIGHT = Math.round(SCREEN_HEIGHT * 0.6);

type ChatFontKey = 'system' | 'serif' | 'mono';

// Map chatSettings.fontFamily values to the CSS font-family string. Mirrors
// the translation done in app/chat/[id].tsx::MessageBubble — keeping these
// in sync is a soft contract enforced by chatSettingsStore.fontFamily being
// a free string.
const FAMILY_PREVIEW_FONT: Record<ChatFontKey, string | undefined> = {
  system: undefined,
  serif: 'serif',
  mono: 'monospace',
};

const CHAT_FONT_OPTIONS: ChatFontKey[] = ['system', 'serif', 'mono'];

export default function ChatFontScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const chatId = id || GLOBAL_CHAT_SETTINGS_KEY;

  const getSettings = useChatSettingsStore((s) => s.getSettings);
  const updateSettings = useChatSettingsStore((s) => s.updateSettings);
  const applied = useMemo(() => getSettings(chatId), [chatId, getSettings]);

  // Map any unknown stored value to 'system' so we always have a valid pill
  // selected. The stored field is technically a free string.
  const initial: ChatFontKey =
    applied.fontFamily === 'serif' || applied.fontFamily === 'mono'
      ? applied.fontFamily
      : 'system';
  const [pending, setPending] = useState<ChatFontKey>(initial);

  const onCancel = () => {
    triggerHaptic('selection');
    router.back();
  };

  const onApply = () => {
    triggerHaptic('medium');
    if (pending !== applied.fontFamily) {
      updateSettings(chatId, { fontFamily: pending });
    }
    router.back();
  };

  const onPick = (key: ChatFontKey) => {
    if (key === pending) return;
    triggerHaptic('selection');
    setPending(key);
  };

  const bgPrimary = theme.colors.background.primary;
  const bgElevated = theme.colors.background.elevated;
  const accent = theme.colors.accent.primary;
  const textPrimary = theme.colors.text.primary;
  const textTertiary = theme.colors.text.tertiary;
  const borderLight = theme.colors.border.light;

  const labelFor = (key: ChatFontKey): string => {
    switch (key) {
      case 'system': return t('chat_settings.font.system');
      case 'serif': return t('chat_settings.font.serif');
      case 'mono': return t('chat_settings.font.mono');
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: bgPrimary }]}>
      <ChatPreviewBubbles
        height={PREVIEW_HEIGHT}
        fontSize={applied.fontSize}
        fontFamily={FAMILY_PREVIEW_FONT[pending]}
        bubbleRadius={applied.bubbleRadius}
        backgroundImage={applied.backgroundImage}
        topPadding={insets.top + 60}
      />

      {/* ── Floating header pills ───────────────────────────────────── */}
      <View style={[styles.headerRow, { top: insets.top + 8 }]} pointerEvents="box-none">
        <Pressable onPress={onCancel} hitSlop={10} style={styles.headerPill}>
          <BlurView intensity={80} tint="dark" style={styles.headerPillInner}>
            <Feather name="x" size={18} color="#FFFFFF" />
          </BlurView>
        </Pressable>
        <View style={styles.headerTitleAbs} pointerEvents="box-none">
          <View style={styles.headerTitlePill}>
            <BlurView intensity={80} tint="dark" style={styles.headerTitleInner}>
              <RNText style={styles.headerTitleText} allowFontScaling={false} numberOfLines={1} ellipsizeMode="tail">
                {t('chat_settings.font_family')}
              </RNText>
            </BlurView>
          </View>
        </View>
        <Pressable onPress={onApply} hitSlop={10} style={styles.headerPill}>
          <BlurView intensity={80} tint="dark" style={[styles.headerPillInner, { paddingHorizontal: 14 }]}>
            <RNText style={styles.headerApplyText} allowFontScaling={false}>
              {t('common.apply')}
            </RNText>
          </BlurView>
        </Pressable>
      </View>

      {/* ── Controls + footer ───────────────────────────────────────── */}
      <View style={[styles.controlsWrap, { paddingBottom: insets.bottom + 16 }]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.pillsRow}
        >
          {CHAT_FONT_OPTIONS.map((key) => {
            const active = pending === key;
            return (
              <Pressable
                key={key}
                onPress={() => onPick(key)}
                style={[
                  styles.pill,
                  {
                    backgroundColor: active ? accent + '20' : bgElevated,
                    borderColor: active ? accent : borderLight,
                    borderWidth: active ? 2 : 0.5,
                  },
                ]}
              >
                <RNText
                  allowFontScaling={false}
                  style={[
                    styles.pillText,
                    {
                      color: active ? accent : textPrimary,
                      fontFamily: FAMILY_PREVIEW_FONT[key],
                      fontWeight: active ? '600' : '400',
                    },
                  ]}
                >
                  {labelFor(key)}
                </RNText>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.footerRow}>
          <Pressable
            onPress={onCancel}
            style={[styles.footerBtn, { backgroundColor: bgElevated, borderColor: borderLight }]}
          >
            <RNText allowFontScaling={false} style={[styles.footerBtnText, { color: textPrimary }]}>
              {t('common.cancel')}
            </RNText>
          </Pressable>
          <Pressable
            onPress={onApply}
            style={[styles.footerBtn, { backgroundColor: accent, borderColor: accent }]}
          >
            <RNText allowFontScaling={false} style={[styles.footerBtnText, { color: '#FFFFFF' }]}>
              {t('common.apply')}
            </RNText>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  headerRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    zIndex: 100,
  },
  headerPill: { borderRadius: 18, overflow: 'hidden' },
  headerPillInner: {
    height: 36,
    minWidth: 36,
    paddingHorizontal: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  headerTitleAbs: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 60,
  },
  headerTitlePill: { borderRadius: 18, overflow: 'hidden', maxWidth: '100%' },
  headerTitleInner: {
    height: 36,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  headerApplyText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },

  controlsWrap: {
    flex: 1,
    paddingTop: 16,
    gap: 16,
    justifyContent: 'flex-start',
  },
  pillsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 10,
    alignItems: 'center',
  },
  pill: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 18,
    minWidth: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillText: { fontSize: 15 },
  footerRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 'auto',
    paddingHorizontal: 16,
  },
  footerBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0.5,
  },
  footerBtnText: { fontSize: 15, fontWeight: '600' },
});
