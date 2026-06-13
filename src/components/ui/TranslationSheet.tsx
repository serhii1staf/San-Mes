import React, { useEffect, useState } from 'react';
import { View, Pressable, ActivityIndicator, ScrollView } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { SlideUpSheet } from './SlideUpSheet';
import { translateText, TranslationResult } from '../../services/translate/libreTranslate';
import { useT, useI18nStore } from '../../i18n/store';
import { showToast } from '../../store/toastStore';
import { triggerHaptic } from '../../utils/haptics';

interface TranslationSheetProps {
  visible: boolean;
  /** Source text to translate. Sheet stays empty when this is empty. */
  text: string;
  onClose: () => void;
}

// Bottom sheet that translates the given text to the user's app locale via
// LibreTranslate. Mirrors Telegram's "Translate" UX:
//   - Shows the translation as the primary content
//   - Original text below in a secondary card so the user can compare
//   - Detected source language label + confidence
//   - "Copy translation" action
//
// Privacy: the source text is sent to libretranslate.com over HTTPS only
// when this sheet opens (i.e. user-initiated). No automatic translation,
// no background translation, no PII apart from what the user typed.
export function TranslationSheet({ visible, text, onClose }: TranslationSheetProps) {
  const theme = useTheme();
  const t = useT();
  const target = useI18nStore((s) => s.locale);
  const [result, setResult] = useState<TranslationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  // Reset + re-fetch each time the sheet opens with a new source text.
  // We deliberately key on `visible+text` so re-opening for the same
  // message hits the 7-day MMKV cache and renders instantly.
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
      <View style={{ paddingHorizontal: 18, paddingTop: 8, paddingBottom: 4 }}>
        {/* Header row */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
          <Feather name="globe" size={16} color={theme.colors.accent.primary} />
          <Text variant="body" weight="semibold" style={{ marginLeft: 8 }}>
            {t('translation.title')}
          </Text>
          <View style={{ flex: 1 }} />
          {result ? (
            <Pressable onPress={onCopy} hitSlop={8} style={{ padding: 4 }}>
              <Feather name="copy" size={16} color={theme.colors.text.tertiary} />
            </Pressable>
          ) : null}
        </View>

        {/* Translation panel */}
        <ScrollView
          style={{ maxHeight: 260 }}
          contentContainerStyle={{ paddingBottom: 4 }}
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
              <Text variant="caption" color={theme.colors.text.tertiary} style={{ marginTop: 8, fontSize: 11 }}>
                {t('translation.detected', undefined, {
                  lang: (result.detectedSource || 'auto').toUpperCase(),
                  target: target.toUpperCase(),
                })}
              </Text>
            </>
          ) : null}
        </ScrollView>

        {/* Original text — secondary panel, dimmed. Helps the user compare
            without scrolling back up to the chat. */}
        {text && !loading ? (
          <View
            style={{
              marginTop: 12,
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
      </View>
    </SlideUpSheet>
  );
}
