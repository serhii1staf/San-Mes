/**
 * ChatPreviewBubbles
 * ------------------
 * Shared "chat preview" surface used by every chat-flavoured live-preview
 * modal (chat-background, chat-text-size, chat-bubble-radius, chat-font).
 *
 * Renders the user's wallpaper (or a neutral surface when none is set), a
 * date pill, and two fake bubbles (incoming with a quoted reply + outgoing).
 * The candidate setting is passed via props so the parent owns the pending
 * state and can drive the preview live as the user drags / picks.
 *
 * Visual chrome — gradient fade at the bottom, bubble paddings, reply block
 * styling — mirrors the inline preview in app/settings/fonts-size.tsx so the
 * chat-flow modals feel identical to the global font modals.
 */

import React from 'react';
import { View, StyleSheet, Text as RNText } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../theme';
import { useT } from '../../i18n/store';
import { ChatBackgroundLayer } from './ChatBackgroundLayer';

export interface ChatPreviewBubblesProps {
  /** Outer height of the preview surface. Parents typically use 60% of screen height. */
  height: number;
  /** Numeric pixel size used for both bubbles' body text. */
  fontSize: number;
  /** Optional CSS font-family string (e.g. 'serif', 'monospace', 'Inter_400Regular'). */
  fontFamily?: string;
  /** Bubble corner radius in px. */
  bubbleRadius: number;
  /** Optional wallpaper URI. When omitted, falls back to a neutral surface. */
  backgroundImage?: string;
  /** Top padding inside the preview (typically `insets.top + 60` to clear the header pills). */
  topPadding: number;
  /** When true, RN scales text per the OS accessibility setting. Default false (faithful preview). */
  allowFontScaling?: boolean;
  /** Outgoing-bubble color. Defaults to the theme accent (current behaviour). */
  bubbleColor?: string;
  /** Outgoing-bubble text color. Defaults to white. */
  bubbleTextColor?: string;
}

// 4 px on the inside corner that points to the avatar — matches MessageBubble
// in app/chat/[id].tsx so the preview shape is the real one.
const TAIL_CORNER = 4;

export function ChatPreviewBubbles({
  height,
  fontSize,
  fontFamily,
  bubbleRadius,
  backgroundImage,
  topPadding,
  allowFontScaling = false,
  bubbleColor,
  bubbleTextColor,
}: ChatPreviewBubblesProps) {
  const theme = useTheme();
  const t = useT();

  const bgPrimary = theme.colors.background.primary;
  const accent = theme.colors.accent.primary;
  // Outgoing bubble color + its text color (defaults preserve the old look).
  const outBubble = bubbleColor || accent;
  const outText = bubbleTextColor || '#FFFFFF';
  const outTextFaint = outText === '#FFFFFF' ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.55)';
  const textPrimary = theme.colors.text.primary;
  const textSecondary = theme.colors.text.secondary;
  const textTertiary = theme.colors.text.tertiary;

  // Reply text is two pts smaller than body, with a 9 px floor so very small
  // sizes still render legibly in the preview.
  const replyFontSize = Math.max(11, fontSize - 3);
  const timeFontSize = Math.max(9, fontSize - 5);

  return (
    <View style={[styles.previewWrap, { height, backgroundColor: theme.colors.background.secondary }]}>
      {backgroundImage ? (
        <ChatBackgroundLayer uri={backgroundImage} proxyWidth={800} />
      ) : null}
      {/* Soft fade so the preview blends into the controls below */}
      <LinearGradient
        colors={['transparent', bgPrimary]}
        locations={[0.7, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <View style={[styles.bubblesPad, { paddingTop: topPadding }]}>
        {/* Date pill */}
        <View style={styles.datePillWrap}>
          <View style={styles.datePill}>
            <RNText allowFontScaling={allowFontScaling} style={styles.datePillText}>
              {t('fonts.preview.today')}
            </RNText>
          </View>
        </View>

        {/* Incoming bubble with quoted-reply */}
        <View style={[styles.bubbleRow, { alignSelf: 'flex-start' }]}>
          <View
            style={[
              styles.bubble,
              {
                backgroundColor: theme.colors.background.tertiary,
                borderRadius: bubbleRadius,
                borderBottomLeftRadius: TAIL_CORNER,
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
                allowFontScaling={allowFontScaling}
                style={[
                  styles.replyName,
                  { color: accent, fontSize: replyFontSize, fontFamily },
                ]}
                numberOfLines={1}
              >
                {t('chat.peer', 'Собеседник')}
              </RNText>
              <RNText
                allowFontScaling={allowFontScaling}
                style={[
                  styles.replyText,
                  { color: textSecondary, fontSize: replyFontSize, fontFamily },
                ]}
                numberOfLines={1}
              >
                {t('chat_settings.preview.msg1', 'Привет! Как дела? 😊')}
              </RNText>
            </View>
            <RNText
              allowFontScaling={allowFontScaling}
              style={[
                styles.bubbleText,
                { color: textPrimary, fontSize, fontFamily },
              ]}
            >
              {t('chat_settings.preview.msg2', 'Всё отлично, спасибо!')}
            </RNText>
            <RNText
              allowFontScaling={allowFontScaling}
              style={[styles.bubbleTime, { color: textTertiary, fontSize: timeFontSize }]}
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
              {
                backgroundColor: outBubble,
                borderRadius: bubbleRadius,
                borderBottomRightRadius: TAIL_CORNER,
              },
            ]}
          >
            <RNText
              allowFontScaling={allowFontScaling}
              style={[
                styles.bubbleText,
                { color: outText, fontSize, fontFamily },
              ]}
            >
              {t('chat_settings.preview.msg3', 'Давай встретимся завтра?')}
            </RNText>
            <RNText
              allowFontScaling={allowFontScaling}
              style={[
                styles.bubbleTime,
                { color: outTextFaint, fontSize: timeFontSize },
              ]}
            >
              12:32
            </RNText>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
  },
  bubbleText: {
    fontWeight: '400',
  },
  bubbleTime: {
    marginTop: 3,
    alignSelf: 'flex-end',
    fontVariant: ['tabular-nums'],
  },
  replyBlock: {
    borderLeftWidth: 2,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginBottom: 6,
  },
  replyName: { fontWeight: '600' },
  replyText: { marginTop: 1 },
});
