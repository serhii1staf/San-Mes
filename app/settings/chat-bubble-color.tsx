/**
 * Telegram-style fullscreen "Bubble color" picker.
 *
 * Same shell as chat-bubble-radius: a live ChatPreviewBubbles surface up top
 * (driven by the pending color so the outgoing bubble recolors as you tap),
 * a swatch grid + "follow theme" chip, and an equal-width Cancel / Apply
 * footer. Drives the app-wide `chatBubbleColor` field on settingsStore
 * (null = follow the theme accent).
 */

import React, { useState } from 'react';
import { View, Pressable, StyleSheet, Text as RNText, ScrollView, Dimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { useTheme } from '../../src/theme';
import { ShrinkingModalTitle } from '../../src/components/ui';
import { useLiquidGlassActive, NativeGlassView, GlassBg } from '../../src/components/ui/LiquidGlass';
import { ChatPreviewBubbles } from '../../src/components/ui/ChatPreviewBubbles';
import { useChatSettingsStore, GLOBAL_CHAT_SETTINGS_KEY } from '../../src/store/chatSettingsStore';
import { useSettingsStore } from '../../src/store/settingsStore';
import { BUBBLE_COLORS, readableTextOn } from '../../src/constants/bubbleColors';
import { triggerHaptic } from '../../src/utils/haptics';
import { useT } from '../../src/i18n/store';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const PREVIEW_HEIGHT = Math.round(SCREEN_HEIGHT * 0.52);
const SWATCH = 46;

export default function ChatBubbleColorScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  const glassActive = useLiquidGlassActive();

  // App-wide bubble color (null = follow theme accent).
  const current = useSettingsStore((s) => s.chatBubbleColor);
  const setChatBubbleColor = useSettingsStore((s) => s.setChatBubbleColor);
  // Read the global chat-settings for a faithful preview (font / radius / bg).
  const getSettings = useChatSettingsStore((s) => s.getSettings);
  const applied = getSettings(GLOBAL_CHAT_SETTINGS_KEY);

  const [pending, setPending] = useState<string | null>(current ?? null);

  const accent = theme.colors.accent.primary;
  const previewBubble = pending || accent;
  const previewText = pending ? readableTextOn(pending) : '#FFFFFF';

  const onCancel = () => { triggerHaptic('selection'); router.back(); };
  const onApply = () => {
    triggerHaptic('medium');
    setChatBubbleColor(pending);
    router.back();
  };
  const onPick = (color: string | null) => {
    if (color !== pending) { triggerHaptic('selection'); setPending(color); }
  };

  const bgPrimary = theme.colors.background.primary;
  const bgElevated = theme.colors.background.elevated;
  const textPrimary = theme.colors.text.primary;
  const borderLight = theme.colors.border.light;

  return (
    <View style={[styles.root, { backgroundColor: bgPrimary }]}>
      <ChatPreviewBubbles
        height={PREVIEW_HEIGHT}
        fontSize={applied.fontSize}
        fontFamily={applied.fontFamily === 'mono' ? 'monospace' : applied.fontFamily === 'serif' ? 'serif' : undefined}
        bubbleRadius={applied.bubbleRadius}
        backgroundImage={applied.backgroundImage}
        topPadding={insets.top + 60}
        bubbleColor={previewBubble}
        bubbleTextColor={previewText}
      />

      {/* ── Floating header pills ───────────────────────────────────── */}
      <View style={[styles.headerRow, { top: 28 }]} pointerEvents="box-none">
        <Pressable onPress={onCancel} hitSlop={10} style={glassActive ? [styles.headerPill, { overflow: 'visible' }] : styles.headerPill}>
          {glassActive ? (
            <NativeGlassView glassStyle="regular" isInteractive colorScheme="dark" style={[styles.headerPillInner, { borderRadius: 18 }]}>
              <Feather name="x" size={18} color="#FFFFFF" />
            </NativeGlassView>
          ) : (
            <BlurView intensity={80} tint="dark" style={styles.headerPillInner}>
              <Feather name="x" size={18} color="#FFFFFF" />
            </BlurView>
          )}
        </Pressable>
        <View style={styles.headerTitleAbs} pointerEvents="box-none">
          <ShrinkingModalTitle>
            <View style={styles.headerTitlePill}>
              {glassActive ? (
                <View style={[styles.headerTitleInner, { borderRadius: 18, overflow: 'hidden' }]}>
                  <GlassBg borderRadius={18} colorScheme="dark" />
                  <RNText style={styles.headerTitleText} allowFontScaling={false} numberOfLines={1}>
                    {t('chat_settings.bubble_color', 'Цвет пузырей')}
                  </RNText>
                </View>
              ) : (
                <BlurView intensity={80} tint="dark" style={styles.headerTitleInner}>
                  <RNText style={styles.headerTitleText} allowFontScaling={false} numberOfLines={1}>
                    {t('chat_settings.bubble_color', 'Цвет пузырей')}
                  </RNText>
                </BlurView>
              )}
            </View>
          </ShrinkingModalTitle>
        </View>
        <Pressable onPress={onApply} hitSlop={10} style={glassActive ? [styles.headerPill, { overflow: 'visible' }] : styles.headerPill}>
          {glassActive ? (
            <NativeGlassView glassStyle="regular" isInteractive colorScheme="dark" style={[styles.headerPillInner, { paddingHorizontal: 14, borderRadius: 18 }]}>
              <RNText style={styles.headerApplyText} allowFontScaling={false}>{t('common.apply')}</RNText>
            </NativeGlassView>
          ) : (
            <BlurView intensity={80} tint="dark" style={[styles.headerPillInner, { paddingHorizontal: 14 }]}>
              <RNText style={styles.headerApplyText} allowFontScaling={false}>{t('common.apply')}</RNText>
            </BlurView>
          )}
        </Pressable>
      </View>

      {/* ── Swatch grid + footer ────────────────────────────────────── */}
      <View style={[styles.controlsWrap, { paddingBottom: insets.bottom + 16 }]}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.swatchGrid}>
          {/* "Follow theme" chip — clears the override (pending = null). */}
          <Pressable onPress={() => onPick(null)} style={styles.swatchWrap}>
            <View
              style={[
                styles.swatch,
                {
                  backgroundColor: accent,
                  borderWidth: pending === null ? 3 : 0,
                  borderColor: textPrimary,
                },
              ]}
            >
              <Feather name="droplet" size={18} color="#FFFFFF" />
            </View>
            <RNText style={[styles.swatchLabel, { color: theme.colors.text.tertiary }]} numberOfLines={1} allowFontScaling={false}>
              {t('chat_settings.bubble_color.theme', 'Тема')}
            </RNText>
          </Pressable>

          {BUBBLE_COLORS.map((sw) => {
            const selected = pending === sw.color;
            return (
              <Pressable key={sw.key} onPress={() => onPick(sw.color)} style={styles.swatchWrap}>
                <View
                  style={[
                    styles.swatch,
                    {
                      backgroundColor: sw.color,
                      borderWidth: selected ? 3 : 0,
                      borderColor: textPrimary,
                    },
                  ]}
                >
                  {selected ? <Feather name="check" size={20} color={readableTextOn(sw.color)} /> : null}
                </View>
                <RNText style={[styles.swatchLabel, { color: theme.colors.text.tertiary }]} numberOfLines={1} allowFontScaling={false}>
                  {sw.label}
                </RNText>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.footerRow}>
          <Pressable onPress={onCancel} style={[styles.footerBtn, { backgroundColor: bgElevated, borderColor: borderLight }]}>
            <RNText allowFontScaling={false} style={[styles.footerBtnText, { color: textPrimary }]}>{t('common.cancel')}</RNText>
          </Pressable>
          <Pressable onPress={onApply} style={[styles.footerBtn, { backgroundColor: previewBubble, borderColor: previewBubble }]}>
            <RNText allowFontScaling={false} style={[styles.footerBtnText, { color: previewText }]}>{t('common.apply')}</RNText>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  headerRow: {
    position: 'absolute', left: 0, right: 0, height: 36,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, zIndex: 100,
  },
  headerPill: { borderRadius: 18, overflow: 'hidden' },
  headerPillInner: {
    height: 36, minWidth: 36, paddingHorizontal: 6,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  headerTitleAbs: {
    position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 60,
  },
  headerTitlePill: { borderRadius: 18, overflow: 'hidden', maxWidth: '100%' },
  headerTitleInner: {
    height: 36, paddingHorizontal: 18,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
  },
  headerTitleText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  headerApplyText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },

  controlsWrap: { flex: 1, paddingHorizontal: 16, paddingTop: 16, gap: 12 },
  swatchGrid: {
    flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between',
    rowGap: 14, paddingBottom: 8,
  },
  swatchWrap: { width: '20%', alignItems: 'center', gap: 5 },
  swatch: {
    width: SWATCH, height: SWATCH, borderRadius: SWATCH / 2,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  swatchLabel: { fontSize: 10, fontWeight: '500' },
  footerRow: { flexDirection: 'row', gap: 10, marginTop: 'auto' },
  footerBtn: {
    flex: 1, paddingVertical: 14, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center', borderWidth: 0.5,
  },
  footerBtnText: { fontSize: 15, fontWeight: '600' },
});
