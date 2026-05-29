import React, { useState } from 'react';
import { View, Text as RNText, Pressable, TextStyle } from 'react-native';
import { router } from 'expo-router';
import { useTheme } from '../../theme';

interface FormattedTextProps {
  children: string;
  style?: TextStyle;
  color?: string;
}

/**
 * Renders text with formatting:
 * @username — clickable mention (blue, opens profile)
 * **bold** — bold text
 * *italic* — italic text
 * ||spoiler|| — hidden until tapped
 * `code` — monospace in box
 * ~~strike~~ — strikethrough
 * __underline__ — underlined text
 * #hashtag — clickable hashtag (accent color)
 */
export function FormattedText({ children, style, color }: FormattedTextProps) {
  const theme = useTheme();
  const [revealedSpoilers, setRevealedSpoilers] = useState<Set<number>>(new Set());
  const textColor = color || theme.colors.text.primary;

  const revealSpoiler = (index: number) => {
    setRevealedSpoilers(prev => new Set(prev).add(index));
  };

  const parts = parseFormatting(children);
  let spoilerIdx = 0;

  return (
    <RNText style={[{ color: textColor, fontSize: 14 * (theme.fontScale || 1) }, style]}>
      {parts.map((part, i) => {
        switch (part.type) {
          case 'text':
            return <RNText key={i}>{part.content}</RNText>;

          case 'bold':
            return <RNText key={i} style={{ fontWeight: '700' }}>{part.content}</RNText>;

          case 'italic':
            return <RNText key={i} style={{ fontStyle: 'italic' }}>{part.content}</RNText>;

          case 'strike':
            return <RNText key={i} style={{ textDecorationLine: 'line-through' }}>{part.content}</RNText>;

          case 'underline':
            return <RNText key={i} style={{ textDecorationLine: 'underline' }}>{part.content}</RNText>;

          case 'code':
            return (
              <RNText key={i} style={{ fontFamily: 'Courier', backgroundColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', paddingHorizontal: 3, borderRadius: 3, fontSize: 13 * (theme.fontScale || 1) }}>
                {part.content}
              </RNText>
            );

          case 'spoiler': {
            const idx = spoilerIdx++;
            const revealed = revealedSpoilers.has(idx);
            if (revealed) {
              return <RNText key={i} style={{ backgroundColor: theme.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)', borderRadius: 3 }}>{part.content}</RNText>;
            }
            return (
              <RNText key={i} onPress={() => revealSpoiler(idx)} style={{ backgroundColor: theme.isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)', color: 'transparent', borderRadius: 3, overflow: 'hidden' }}>
                {part.content}
              </RNText>
            );
          }

          case 'mention':
            return (
              <RNText key={i} onPress={() => { /* search user by username and navigate */ }} style={{ color: theme.colors.accent.primary, fontWeight: '600' }}>
                @{part.content}
              </RNText>
            );

          case 'hashtag':
            return (
              <RNText key={i} style={{ color: theme.colors.accent.primary, fontWeight: '500' }}>
                #{part.content}
              </RNText>
            );

          default:
            return <RNText key={i}>{part.content}</RNText>;
        }
      })}
    </RNText>
  );
}

interface TextPart {
  type: 'text' | 'bold' | 'italic' | 'strike' | 'underline' | 'code' | 'spoiler' | 'mention' | 'hashtag';
  content: string;
}

function parseFormatting(text: string): TextPart[] {
  const parts: TextPart[] = [];
  // Regex for all format patterns
  const regex = /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(~~(.+?)~~)|(__(.+?)__)|(`(.+?)`)|(\|\|(.+?)\|\|)|(@(\w+))|(#(\w+))/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    // Add plain text before this match
    if (match.index > lastIndex) {
      parts.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    }

    if (match[1]) parts.push({ type: 'bold', content: match[2] });
    else if (match[3]) parts.push({ type: 'italic', content: match[4] });
    else if (match[5]) parts.push({ type: 'strike', content: match[6] });
    else if (match[7]) parts.push({ type: 'underline', content: match[8] });
    else if (match[9]) parts.push({ type: 'code', content: match[10] });
    else if (match[11]) parts.push({ type: 'spoiler', content: match[12] });
    else if (match[13]) parts.push({ type: 'mention', content: match[14] });
    else if (match[15]) parts.push({ type: 'hashtag', content: match[16] });

    lastIndex = match.index + match[0].length;
  }

  // Remaining text
  if (lastIndex < text.length) {
    parts.push({ type: 'text', content: text.slice(lastIndex) });
  }

  return parts.length > 0 ? parts : [{ type: 'text', content: text }];
}
