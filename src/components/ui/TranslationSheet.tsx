import React, { useEffect, useState } from 'react';
import { View, Pressable, ActivityIndicator, ScrollView, Dimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { SlideUpSheet } from './SlideUpSheet';
import { translateText, TranslationResult } from '../../services/translate/libreTranslate';
import { useT, useI18nStore } from '../../i18n/store';
import { showToast } from '../../store/toastStore';
import { triggerHaptic } from '../../utils/haptics';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
// Hard cap the entire sheet at ~58 % of the screen so it can never grow tall
// enough to push the close affordance off-screen, even with a multi-paragraph
// message body. Inner content scrolls within this bound.
const MAX_SHEET_HEIGHT = SCREEN_HEIGHT * 0.58;

interface TranslationSheetProps {
  visible: boolean;
  /** Source text to translate. Sheet stays empty when this is empty. */
  text: string;
  onClose: () => void;
}

// Bottom sheet that translates the given text to the user's app locale via
// a multi-provider cascade (Google gtx → MyMemory → LibreTranslate). Mirrors
// Telegram's "Translate" UX:
//   - Translation is the primary content
//   - Original text below in a secondary card so the user can compare
//   - Detected source language label
//   - Explicit close button (×) on the header — tapping the backdrop also
//     dismisses, but the X is reachable even when the sheet is at full height.
//   - The whole content sits inside a single ScrollView with a hard
//     max-height (60 % screen) so a long message can't blow up the sheet.
//
// Privacy: the source text is sent to a public translation endpoint over
// HTTPS only when this sheet opens (i.e. user-initiated). No automatic
// translation, no background translation.
export function TranslationSheet({ visible, text, onClose }: TranslationSheetProps) {
  const theme = useTheme();
  const t = useT();
  const target = useI18nStore((s) => s.locale);
  const [result, setResult] = useState<TranslationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  // Reset + re-fetch each time the sheet opens with a new source text.
  // Re-opening for the same message hits the 7-day MMKV cache and renders
  // instantly.
  useEffect(() => {
    if (!visible || !text) return;
    let cancelled = false;
    setResult(null);
    setFailed(false);
    setLoading(true);
    void (async () => {
      const r = await translateText(text, target);
      if (cancelled) return;
      if (r) {
        setResult(r);
      } else {
        setFailed(true);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, text, target]);

  const cardBg = theme.isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)';

  const onCopy = async () => {
    if (!result) return;
    triggerHaptic('selection');
    await Clipboard.setStringAsync(result.text);
    showToast(t('toast.copied'), 'check');
  };

  return (
    <SlideUpSheet visible={visible} onClose={onClose}>
      {/* The sheet's max height is enforced HERE rather than on the inner
          ScrollView so the close button + header stay anchored at the top
          even on multi-paragraph translations. Without this cap a 5-screen
          message body would push everything off the bottom of the device. */}
      <View style={{ maxHeight: MAX_SHEET_HEIGHT }}>
        {/* Header row — globe icon, title, copy button, explicit close. */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 18,
            paddingTop: 8,
            paddingBottom: 10,
          }}
        >
          <Feather name="globe" size={16} color={theme.colors.accent.primary} />
          <Text variant="body" weight="semibold" style={{ marginLeft: 8 }}>
            {t('translation.title')}
          </Text>
          <View style={{ flex: 1 }} />
          {result ? (
            <Pressable
              onPress={onCopy}
              hitSlop={8}
              style={{ padding: 6, marginRight: 4 }}
              accessibilityLabel={t('translation.copy_a11y')}
            >
              <Feather name="copy" size={16} color={theme.colors.text.tertiary} />
            </Pressable>
          ) : null}
          {/* Explicit close — guarantees the user can dismiss even when the
              backdrop is hidden behind a long-content render glitch. */}
          <Pressable
            onPress={() => {
              triggerHaptic('selection');
              onClose();
            }}
            hitSlop={10}
            style={{ padding: 6 }}
            accessibilityLabel={t('common.close')}
          >
            <Feather name="x" size={20} color={theme.colors.text.secondary} />
          </Pressable>
        </View>

        {/* Single scrollable body — both the translation panel and the
            original-text card share this scroll, so even a 10 KB message
            stays bounded by MAX_SHEET_HEIGHT. */}
        <ScrollView
          style={{ flexGrow: 0 }}
          contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 8 }}
          showsVerticalScrollIndicator={false}
        >
          {loading ? (
            <View style={{ paddingVertical: 24, alignItems: 'center' }}>
              <ActivityIndicator size="small" color={theme.colors.text.tertiary} />
            </View>
          ) : failed ? (
            <View style={{ paddingVertical: 18 }}>
              <Text variant="body" color={theme.colors.text.tertiary}>
                {t('translation.error')}
              </Text>
            </View>
          ) : result ? (
            <>
              <Text variant="body" style={{ fontSize: 15, lineHeight: 22 }}>
                {result.text}
              </Text>
              <Text
                variant="caption"
                color={theme.colors.text.tertiary}
                style={{ marginTop: 8, fontSize: 11 }}
              >
                {t('translation.detected', undefined, {
                  lang: (result.detectedSource || 'auto').toUpperCase(),
                  target: target.toUpperCase(),
                })}
              </Text>
            </>
          ) : null}

          {/* Original text — secondary panel, dimmed. Even very long text
              stays inside the parent ScrollView so the user can scroll
              within the sheet rather than the whole sheet growing. */}
          {text && !loading ? (
            <View
              style={{
                marginTop: 14,
                padding: 12,
                borderRadius: 12,
                backgroundColor: cardBg,
              }}
            >
              <Text
                variant="caption"
                color={theme.colors.text.tertiary}
                style={{ fontSize: 11, marginBottom: 4, textTransform: 'uppercase' }}
              >
                {t('translation.original')}
              </Text>
              <Text variant="body" color={theme.colors.text.secondary} style={{ fontSize: 14 }}>
                {text}
              </Text>
            </View>
          ) : null}
        </ScrollView>
      </View>
    </SlideUpSheet>
  );
}
