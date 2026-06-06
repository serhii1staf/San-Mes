import React, { useState } from 'react';
import { View, Text as RNText, Pressable, TextStyle } from 'react-native';
import { router } from 'expo-router';
import { useTheme } from '../../theme';
import { openUrl } from '../../utils/openUrl';

interface FormattedTextProps {
  children: string;
  style?: TextStyle;
  color?: string;
  linkColor?: string;
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
export function FormattedText({ children, style, color, linkColor }: FormattedTextProps) {
  const theme = useTheme();
  const [revealedSpoilers, setRevealedSpoilers] = useState<Set<number>>(new Set());
  const textColor = color || theme.colors.text.primary;
  const resolvedLinkColor = linkColor || theme.colors.accent.primary;

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

          case 'link':
            return (
              <RNText key={i} onPress={() => openUrl(part.content)} style={{ color: resolvedLinkColor, textDecorationLine: 'underline' }}>
                {shortenUrl(part.content)}
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
  type: 'text' | 'bold' | 'italic' | 'strike' | 'underline' | 'code' | 'spoiler' | 'mention' | 'hashtag' | 'link';
  content: string;
}

// Display links compactly: strip protocol/www and, for our own deep links,
// show just the domain + section (e.g. "san-m-app.com/post") instead of the
// long id. The full URL is still used for the tap action. Pure + cheap.
function shortenUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    const seg = u.pathname.split('/').filter(Boolean);
    if (seg.length === 0) return host;
    // For known sections keep only the section name, drop the long id.
    if (seg[0] === 'post' || seg[0] === 'profile' || seg[0] === 'comments') {
      return `${host}/${seg[0]}`;
    }
    // Otherwise show host + first segment, truncated.
    const tail = seg[0].length > 16 ? seg[0].slice(0, 15) + '…' : seg[0];
    return `${host}/${tail}`;
  } catch {
    // Not a parseable URL — strip protocol and clip length.
    const clean = url.replace(/^https?:\/\/(www\.)?/, '');
    return clean.length > 30 ? clean.slice(0, 29) + '…' : clean;
  }
}

function parseFormatting(text: string): TextPart[] {
  const parts: TextPart[] = [];
  // Regex for all format patterns (URLs first so they aren't broken by other rules)
  const regex = /(https?:\/\/[^\s]+)|(\*\*(.+?)\*\*)|(\*(.+?)\*)|(~~(.+?)~~)|(__(.+?)__)|(`(.+?)`)|(\|\|(.+?)\|\|)|(@(\w+))|(#(\w+))/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    // Add plain text before this match
    if (match.index > lastIndex) {
      parts.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    }

    if (match[1]) parts.push({ type: 'link', content: match[1] });
    else if (match[2]) parts.push({ type: 'bold', content: match[3] });
    else if (match[4]) parts.push({ type: 'italic', content: match[5] });
    else if (match[6]) parts.push({ type: 'strike', content: match[7] });
    else if (match[8]) parts.push({ type: 'underline', content: match[9] });
    else if (match[10]) parts.push({ type: 'code', content: match[11] });
    else if (match[12]) parts.push({ type: 'spoiler', content: match[13] });
    else if (match[14]) parts.push({ type: 'mention', content: match[15] });
    else if (match[16]) parts.push({ type: 'hashtag', content: match[17] });

    lastIndex = match.index + match[0].length;
  }

  // Remaining text
  if (lastIndex < text.length) {
    parts.push({ type: 'text', content: text.slice(lastIndex) });
  }

  return parts.length > 0 ? parts : [{ type: 'text', content: text }];
}
