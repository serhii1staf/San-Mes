/**
 * Telegram-style fullscreen "Font" preview modal.
 *
 * Same shell as fonts-size.tsx — floating blur header pills, a chat
 * preview against the user's wallpaper, then a horizontally-scrolling pill
 * row of FONT_FAMILIES. Tapping a pill updates the LIVE preview (no
 * commit). Apply commits the pending family via setFontFamily.
 */

import React, { useState } from 'react';
import {
  View,
  Pressable,
  StyleSheet,
  Text as RNText,
  ScrollView,
  Dimensions,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { useTheme } from '../../src/theme';
import { ShrinkingModalTitle } from '../../src/components/ui';
import { CachedImage } from '../../src/components/ui/CachedImage';
import {
  useThemeStore,
  FONT_FAMILIES,
  FontFamily,
} from '../../src/store/themeStore';
import {
  useChatSettingsStore,
  GLOBAL_CHAT_SETTINGS_KEY,
} from '../../src/store/chatSettingsStore';
import { triggerHaptic } from '../../src/utils/haptics';
import { useT } from '../../src/i18n/store';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const PREVIEW_HEIGHT = Math.round(SCREEN_HEIGHT * 0.6);

// Font family used for the preview text + pill labels. Must match what
// ThemeProvider builds for each FontFamily key, so the live preview and
// the committed appearance look identical.
const FAMILY_PREVIEW_FONT: Record<FontFamily, string> = {
  inter: 'Inter_400Regular',
  system: 'System',
  serif: 'Georgia',
  mono: 'Courier',
};

const PREVIEW_BASE_FONT = 15;

export default function FontsFamilyScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();
  const currentFamily = useThemeStore((s) => s.fontFamily);
  const setFontFamily = useThemeStore((s) => s.setFontFamily);
  const wallpaper = useChatSettingsStore(
    (s) => s.settings[GLOBAL_CHAT_SETTINGS_KEY]?.backgroundImage,
  );

  const [pending, setPending] = useState<FontFamily>(currentFamily);
  const previewFontFamily = FAMILY_PREVIEW_FONT[pending];

  const handleCancel = () => {
    triggerHaptic('selection');
    router.back();
  };

  const handleApply = () => {
    triggerHaptic('medium');
    if (pending !== currentFamily) setFontFamily(pending);
    router.back();
  };

  const onPickFamily = (key: FontFamily) => {
    if (key === pending) return;
    triggerHaptic('selection');
    setPending(key);
  };

  const bgPrimary = theme.colors.background.primary;
  const bgElevated = theme.colors.background.elevated;
  const accent = theme.colors.accent.primary;
  const textPrimary = theme.colors.text.primary;
  const textSecondary = theme.colors.text.secondary;
  const textTertiary = theme.colors.text.tertiary;
  const borderLight = theme.colors.border.light;

  return (
    <View style={[styles.root, { backgroundColor: bgPrimary }]}>
      {/* Chat preview area */}
      <View
        style={[
          styles.previewWrap,
          { height: PREVIEW_HEIGHT, backgroundColor: theme.colors.background.secondary },
        ]}
      >
        {wallpaper ? (
          <CachedImage
            uri={wallpaper}
            style={StyleSheet.absoluteFillObject}
            resizeMode="cover"
            proxyWidth={800}
          />
        ) : null}
        <LinearGradient
          colors={['transparent', bgPrimary]}
          locations={[0.7, 1]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <View style={[styles.bubblesPad, { paddingTop: insets.top + 60 }]}>
          {/* Date pill */}
          <View style={styles.datePillWrap}>
            <View style={styles.datePill}>
              <RNText allowFontScaling={false} style={styles.datePillText}>
                {t('fonts.preview.today')}
              </RNText>
            </View>
          </View>
          {/* Incoming bubble with quoted reply */}
          <View style={[styles.bubbleRow, { alignSelf: 'flex-start' }]}>
            <View
              style={[
                styles.bubble,
                {
                  backgroundColor: theme.colors.background.tertiary,
                  borderBottomLeftRadius: 4,
                },
              ]}
            >
              <View
                style={[
                  styles.replyBlock,
                  { borderLeftColor: accent, backgroundColor: accent + '15' },
                ]}
              >
                <RNText
                  allowFontScaling={false}
                  style={[
                    styles.replyName,
                    { color: accent, fontFamily: previewFontFamily },
                  ]}
                  numberOfLines={1}
                >
                  {t('chat.peer', 'Собеседник')}
                </RNText>
                <RNText
                  allowFontScaling={false}
                  style={[
                    styles.replyText,
                    { color: textSecondary, fontFamily: previewFontFamily },
                  ]}
                  numberOfLines={1}
                >
                  {t('chat_settings.preview.msg1', 'Привет! Как дела? 😊')}
                </RNText>
              </View>
              <RNText
                allowFontScaling={false}
                style={[
                  styles.bubbleText,
                  {
                    color: textPrimary,
                    fontFamily: previewFontFamily,
                    fontSize: PREVIEW_BASE_FONT,
                  },
                ]}
              >
                {t('chat_settings.preview.msg2', 'Всё отлично, спасибо!')}
              </RNText>
              <RNText
                allowFontScaling={false}
                style={[styles.bubbleTime, { color: textTertiary }]}
              >
                12:31
              </RNText>
            </View>
          </View>
          {/* Outgoing bubble */}
          <View style={[styles.bubbleRow, { alignSelf: 'flex-end' }]}>
            <View
              style={[
                styles.bubble,
                { backgroundColor: accent, borderBottomRightRadius: 4 },
              ]}
            >
              <RNText
                allowFontScaling={false}
                style={[
                  styles.bubbleText,
                  {
                    color: '#FFFFFF',
                    fontFamily: previewFontFamily,
                    fontSize: PREVIEW_BASE_FONT,
                  },
                ]}
              >
                {t('chat_settings.preview.msg3', 'Давай встретимся завтра?')}
              </RNText>
              <RNText
                allowFontScaling={false}
                style={[styles.bubbleTime, { color: 'rgba(255,255,255,0.7)' }]}
              >
                12:32
              </RNText>
            </View>
          </View>
        </View>
      </View>

      {/* ── Floating header pills ───────────────────────────────────── */}
      <View style={[styles.headerRow, { top: 28 }]} pointerEvents="box-none">
        <Pressable onPress={handleCancel} hitSlop={10} style={styles.headerPill}>
          <BlurView intensity={80} tint="dark" style={styles.headerPillInner}>
            <Feather name="x" size={18} color="#FFFFFF" />
          </BlurView>
        </Pressable>
        <View style={styles.headerTitleAbs} pointerEvents="box-none">
          <View style={styles.headerTitlePill}>
            <BlurView intensity={80} tint="dark" style={styles.headerTitleInner}>
              <ShrinkingModalTitle>
                <RNText
                  style={styles.headerTitleText}
                  allowFontScaling={false}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {t('fonts.font_title')}
                </RNText>
              </ShrinkingModalTitle>
            </BlurView>
          </View>
        </View>
        <Pressable onPress={handleApply} hitSlop={10} style={styles.headerPill}>
          <BlurView
            intensity={80}
            tint="dark"
            style={[styles.headerPillInner, { paddingHorizontal: 14 }]}
          >
            <RNText style={styles.headerApplyText} allowFontScaling={false}>
              {t('common.apply')}
            </RNText>
          </BlurView>
        </Pressable>
      </View>

      {/* ── Controls + footer ───────────────────────────────────────── */}
      <View style={[styles.controlsWrap, { paddingBottom: insets.bottom + 16 }]}>
        {/* Horizontally-scrolling family pills */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.pillsRow}
        >
          {FONT_FAMILIES.map((f) => {
            const active = pending === f.key;
            const previewFont = FAMILY_PREVIEW_FONT[f.key];
            const label =
              f.key === 'system' ? t('font.family.system', f.label) : f.label;
            return (
              <Pressable
                key={f.key}
                onPress={() => onPickFamily(f.key)}
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
                      fontFamily: previewFont,
                      fontWeight: active ? '600' : '400',
                    },
                  ]}
                >
                  {label}
                </RNText>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Footer — Cancel / Apply */}
        <View style={styles.footerRow}>
          <Pressable
            onPress={handleCancel}
            style={[
              styles.footerBtn,
              { backgroundColor: bgElevated, borderColor: borderLight },
            ]}
          >
            <RNText
              allowFontScaling={false}
              style={[styles.footerBtnText, { color: textPrimary }]}
            >
              {t('common.cancel')}
            </RNText>
          </Pressable>
          <Pressable
            onPress={handleApply}
            style={[styles.footerBtn, { backgroundColor: accent, borderColor: accent }]}
          >
            <RNText
              allowFontScaling={false}
              style={[styles.footerBtnText, { color: '#FFFFFF' }]}
            >
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
  previewWrap: { width: '100%', overflow: 'hidden' },
  bubblesPad: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    gap: 8,
  },
  datePillWrap: { alignItems: 'center', marginBottom: 12 },
  datePill: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  datePillText: { color: '#FFFFFF', fontSize: 12, fontWeight: '500' },
  bubbleRow: {
    maxWidth: '78%',
    marginBottom: 6,
  },
  bubble: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
  },
  bubbleText: { fontWeight: '400' },
  bubbleTime: {
    marginTop: 3,
    alignSelf: 'flex-end',
    fontSize: 10,
    fontVariant: ['tabular-nums'],
  },
  replyBlock: {
    borderLeftWidth: 2,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginBottom: 6,
  },
  replyName: { fontSize: 12, fontWeight: '600' },
  replyText: { fontSize: 12, marginTop: 1 },
  // Floating header
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
  // Controls + footer
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
