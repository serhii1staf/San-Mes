import React, { memo, useState } from 'react';
import { View, Text as RNText, Pressable, TextStyle, Platform, ScrollView, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { useTheme } from '../../theme';
import { useT } from '../../i18n/store';
import { openUrl } from '../../utils/openUrl';
import { triggerHaptic } from '../../utils/haptics';
import { showToast } from '../../store/toastStore';

interface FormattedTextProps {
  children: string;
  style?: TextStyle;
  color?: string;
  linkColor?: string;
  /**
   * Truncate the rendered text after this many lines. Forwarded to the
   * root <Text> so the FormattedText keeps the same truncation
   * semantics as a plain <Text>. Used by ProfileReplyCard to keep the
   * parent-post snippet on a single line and the user's reply at four.
   */
  numberOfLines?: number;
  /**
   * Optional override for what happens when the user taps a parsed link.
   * Modal-hosted contexts (PostContextMenu, MessageContextMenu, …) MUST
   * pass this so they can dismiss themselves before the navigation runs —
   * otherwise the modal stays mounted with `<StatusBar hidden />` while the
   * browser pushes on top, and on return the host screen appears frozen
   * with the system status bar gone. The default behaviour (`openUrl`) is
   * fine for non-modal callers.
   */
  onLinkPress?: (url: string) => void;
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
 * ```fenced``` — Telegram-style multi-line code block (only when not
 *   truncating, see the block-split path below)
 */
export const FormattedText = memo(function FormattedText({ children, style, color, linkColor, numberOfLines, onLinkPress }: FormattedTextProps) {
  const theme = useTheme();
  const [revealedSpoilers, setRevealedSpoilers] = useState<Set<number>>(new Set());
  const textColor = color || theme.colors.text.primary;
  const resolvedLinkColor = linkColor || theme.colors.accent.primary;
  // Resolve the link tap handler once per render — cheap, and avoids
  // creating a new lambda inside every <RNText> below.
  const handleLinkTap = onLinkPress || openUrl;

  const revealSpoiler = (index: number) => {
    setRevealedSpoilers(prev => new Set(prev).add(index));
  };

  // Parsing runs a regex over the text; memoize per-string so re-renders (theme,
  // scroll, sibling updates) don't re-parse. Big win for long feeds/chats.
  const parts = React.useMemo(() => parseFormatting(children), [children]);

  // Block-split runs on EVERY render (hook order must stay stable), but it
  // returns null instantly for the overwhelmingly common case of text that
  // has no triple-backtick fence — so the cost is a single `includes('```')`.
  // Memoized per-string just like the inline parse above.
  const blockSegments = React.useMemo(() => splitBlocks(children), [children]);

  // FIX (regression in 9d62fa3): only forward `numberOfLines` to the
  // root <Text> when the caller actually passed a value. Spreading it
  // as `numberOfLines={undefined}` looked equivalent to omitting the
  // prop, but on iOS/RN 0.81 the native text layer reads the JS-side
  // attribute as "set to nil" and clamps the rendered line count to 0
  // for nested <Text> trees that already carry textShadow/colour
  // overrides — which is exactly the shape every comment row uses
  // (FormattedText wraps a tree of inline <Text> spans for bold /
  // mentions / spoilers / etc.). Result: comments under posts went
  // blank because the root <Text> was set to "0 lines visible".
  // Building the prop bag conditionally restores the original RN
  // behaviour for callers that don't ask for truncation, while the
  // ProfileReplyCard caller (which DOES pass a number) keeps working.
  const truncationProps = numberOfLines !== undefined ? { numberOfLines } : null;

  // Shared inline renderer. Pulled out of the JSX so the EXACT same inline
  // logic (bold/italic/spoiler/mention/link/inline-code/…) can be reused for
  // every text segment of the block-split path. The `spoilerCounter` is a
  // mutable object so a single component-level spoiler index is shared across
  // all segments — keeping `revealedSpoilers`/`revealSpoiler` working even
  // when text is split around fenced code blocks.
  const renderInline = (inlineParts: TextPart[], spoilerCounter: { value: number }): React.ReactNode => {
    return inlineParts.map((part, i) => {
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
          const idx = spoilerCounter.value++;
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
            <RNText key={i} onPress={() => handleLinkTap(part.content)} style={{ color: resolvedLinkColor, textDecorationLine: 'underline' }}>
              {shortenUrl(part.content)}
            </RNText>
          );

        default:
          return <RNText key={i}>{part.content}</RNText>;
      }
    });
  };

  // Branch selection:
  //  - Single-<Text> path when the caller asked for truncation
  //    (numberOfLines set) OR there is no fenced code block. This is the
  //    original, unchanged render — fenced markers fall through to the inline
  //    parser as plain text, exactly as before.
  //  - Block path otherwise: a <View> column mixing inline text segments and
  //    standalone <CodeBlock> containers.
  const useSingleTextPath = truncationProps !== null || blockSegments === null;

  if (useSingleTextPath) {
    const spoilerCounter = { value: 0 };
    return (
      <RNText {...truncationProps} style={[{ color: textColor, fontSize: 14 * (theme.fontScale || 1) }, style]}>
        {renderInline(parts, spoilerCounter)}
      </RNText>
    );
  }

  // Block render path. A single shared spoiler counter spans all text
  // segments so spoiler reveal indices stay stable across the column.
  const spoilerCounter = { value: 0 };
  return (
    <View style={{ width: '100%' }}>
      {blockSegments!.map((seg, i) => {
        if (seg.kind === 'code') {
          return <CodeBlock key={i} code={seg.value} lang={seg.lang} />;
        }
        const segParts = parseFormatting(seg.value);
        return (
          <RNText key={i} style={[{ color: textColor, fontSize: 14 * (theme.fontScale || 1) }, style]}>
            {renderInline(segParts, spoilerCounter)}
          </RNText>
        );
      })}
    </View>
  );
});

/**
 * Telegram-style fenced code container: monospace, subtle themed background,
 * rounded corners, optional language header + copy affordance, and a
 * horizontal ScrollView so long lines extend off-screen and scroll rather
 * than wrap. Memoized — the code/lang only change when the source string does.
 */
const CodeBlock = memo(function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const theme = useTheme();
  const t = useT();
  const textColor = theme.colors.text.primary;
  const hasLang = lang.trim().length > 0;

  const handleCopy = async () => {
    try {
      await Clipboard.setStringAsync(code);
      triggerHaptic('light');
      showToast(t('toast.copied'), 'copy');
    } catch {
      // Clipboard can reject (rare); fail silently so the bubble stays usable.
    }
  };

  return (
    <View
      style={{
        marginVertical: 4,
        borderRadius: 12,
        overflow: 'hidden',
        backgroundColor: theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.08)',
      }}
    >
      {hasLang ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: 10,
            paddingTop: 8,
            paddingBottom: 2,
          }}
        >
          <RNText
            style={{
              fontSize: 11,
              color: theme.colors.text.tertiary,
              fontWeight: '600',
              textTransform: 'lowercase',
            }}
          >
            {lang}
          </RNText>
          <Pressable hitSlop={8} onPress={handleCopy} style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Feather name="copy" size={13} color={theme.colors.text.tertiary} />
          </Pressable>
        </View>
      ) : (
        // No language token: keep a subtle copy affordance in the top-right.
        <Pressable
          hitSlop={8}
          onPress={handleCopy}
          style={{ position: 'absolute', top: 6, right: 6, zIndex: 1, padding: 2 }}
        >
          <Feather name="copy" size={13} color={theme.colors.text.tertiary} />
        </Pressable>
      )}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ padding: 10 }}>
        <RNText
          selectable
          style={{
            fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
            fontSize: 13 * (theme.fontScale || 1),
            color: textColor,
          }}
        >
          {code}
        </RNText>
      </ScrollView>
    </View>
  );
});

interface TextPart {
  type: 'text' | 'bold' | 'italic' | 'strike' | 'underline' | 'code' | 'spoiler' | 'mention' | 'hashtag' | 'link';
  content: string;
}

/** One segment of the block-split: either inline text or a fenced code body. */
type BlockSegment =
  | { kind: 'text'; value: string }
  | { kind: 'code'; lang: string; value: string };

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

// Module-level parse cache: the same text often renders many times (list
// recycling, navigation back-and-forth). Caching the parsed parts avoids
// re-running the regex. Bounded to keep memory tiny.
const parseCache = new Map<string, TextPart[]>();
const PARSE_CACHE_MAX = 500;

function parseFormatting(text: string): TextPart[] {
  const cached = parseCache.get(text);
  if (cached) return cached;
  const result = parseFormattingUncached(text);
  if (parseCache.size >= PARSE_CACHE_MAX) {
    // Drop the oldest entry (first inserted) to bound memory.
    const firstKey = parseCache.keys().next().value;
    if (firstKey !== undefined) parseCache.delete(firstKey);
  }
  parseCache.set(text, result);
  return result;
}

function parseFormattingUncached(text: string): TextPart[] {
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

// Block-split cache, mirroring parseCache and bounded the same way. Splits a
// string into ordered text/code segments around triple-backtick fences.
// Returns null when there is no fence (the common case) so callers can take
// the original single-<Text> path with zero allocation.
const blockCache = new Map<string, BlockSegment[] | null>();
const BLOCK_CACHE_MAX = 500;

function splitBlocks(text: string): BlockSegment[] | null {
  // No fast bail-out on '```' anymore: even fence-less text must run through
  // splitBlocksUncached so the conservative code heuristic (looksLikeCode)
  // gets a chance to auto-wrap pasted snippets. splitBlocksUncached returns
  // null cheaply for the common non-code case, and the cache below guarantees
  // each UNIQUE string runs that heuristic at most once (same discipline as
  // parseCache) so repeated renders never re-run it.
  const cached = blockCache.get(text);
  if (cached !== undefined) return cached;

  const result = splitBlocksUncached(text);
  if (blockCache.size >= BLOCK_CACHE_MAX) {
    const firstKey = blockCache.keys().next().value;
    if (firstKey !== undefined) blockCache.delete(firstKey);
  }
  blockCache.set(text, result);
  return result;
}

function splitBlocksUncached(text: string): BlockSegment[] | null {
  // Optional language token, optional leading newline, then a non-greedy body
  // up to the closing fence.
  const fenceRegex = /```([a-zA-Z0-9+#-]*)\n?([\s\S]*?)```/g;
  const segments: BlockSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let found = false;

  while ((match = fenceRegex.exec(text)) !== null) {
    found = true;
    if (match.index > lastIndex) {
      segments.push({ kind: 'text', value: text.slice(lastIndex, match.index) });
    }
    // Trim a single leading/trailing newline from the code body.
    const body = match[2].replace(/^\n/, '').replace(/\n$/, '');
    segments.push({ kind: 'code', lang: match[1] || '', value: body });
    lastIndex = match.index + match[0].length;
  }

  // No actual closing fence matched (e.g. a lone "```") — fall through to the
  // conservative heuristic. If the whole message clearly looks like code,
  // wrap it as a single CodeBlock; otherwise return null so the caller takes
  // the unchanged single-<Text> path.
  if (!found) {
    if (looksLikeCode(text)) {
      return [{ kind: 'code', lang: '', value: text.replace(/\n+$/, '') }];
    }
    return null;
  }

  if (lastIndex < text.length) {
    segments.push({ kind: 'text', value: text.slice(lastIndex) });
  }

  return segments;
}

// ─── Conservative code auto-detection ───────────────────────────────────────
// When a message has NO explicit ``` fence we still want to recognise raw
// pasted code (C/C++, Java, JS, Python, …) and render it in a CodeBlock. The
// heuristic below is deliberately conservative: it must NOT fire on ordinary
// prose (including short multi-line greetings). All regexes are module-level
// consts so they are compiled once, not per call. None use the `g` flag, so
// `.test()` is stateless (no lastIndex bookkeeping needed).

// STRONG signals: essentially never appear in natural prose. Any match → code.
const STRONG_CODE_PATTERNS: RegExp[] = [
  /#include\s*[<"]/,                                            // C/C++
  /\b(public|private|protected)\s+(static\s+)?(void|int|String|class|final)\b/, // Java/C#
  /\bclass\s+\w+\s*[:({]/,                                      // class decl
  /\b(function|const|let|var)\s+\w+\s*=/,                       // JS binding
  /\bfunction\s+\w+\s*\(/,                                      // JS function
  /=>\s*[{(]/,                                                  // JS arrow
  /\bdef\s+\w+\s*\(.*\)\s*:/,                                   // Python def
  /\b(import|from)\s+[\w.]+\s+(import\b|;)/,                    // Py / Java import
  /^\s*import\s+[\w.{}*\s]+from\s+['"]/m,                       // JS import … from
  /\b(std::|console\.log|System\.out\.print|printf\s*\(|cout\s*<<|fmt\.Print)/, // stdlib calls
  /\b(int|void|float|double|char|bool)\s+main\s*\(/,           // C/C++ main
];

// HTML/XML tag — only counts as a strong signal when there are >= 2 of them.
const HTML_TAG_PATTERN = /<\/?[a-zA-Z][\w-]*(\s[^>]*)?>/g;

// WEAK signals: per-line "code-ish" tests. Individually weak; only decisive in
// multi-line aggregate (see looksLikeCode).
const CODEISH_LINE_END = /[;{},:)]$/;          // line ends with a code punctuator
const CODEISH_INDENT = /^(\s{2,}|\t)/;          // leading indentation
const CODEISH_INLINE = /(\{.*\}|\w+\(|\[\]|=>|===|!==|==|&&|\|\||::|->)/; // call/operator syntax
const CODEISH_KEYWORD = /\b(if|else|for|while|return|switch|case|break|continue|new|try|catch|throw|await|async|export|module|require|struct|enum|interface|typedef|namespace|using|val|fun|let|const|var|func|print|println)\b/;

function looksLikeCode(text: string): boolean {
  if (text.trim().length < 6) return false;

  // STRONG signals → immediate yes (works even for single-line input).
  for (const re of STRONG_CODE_PATTERNS) {
    if (re.test(text)) return true;
  }
  // >= 2 HTML/XML tags is also a strong signal. Reset lastIndex defensively
  // because HTML_TAG_PATTERN carries the global flag.
  HTML_TAG_PATTERN.lastIndex = 0;
  const tagMatches = text.match(HTML_TAG_PATTERN);
  if (tagMatches && tagMatches.length >= 2) return true;

  // WEAK signals: require multi-line context so single sentences never convert.
  const lines = text.split('\n');
  const nonEmpty = lines.filter(l => l.trim().length > 0);
  if (nonEmpty.length < 2) return false;

  let codeishCount = 0;
  for (const line of nonEmpty) {
    const trimmedRight = line.replace(/\s+$/, '');
    const isCodeish =
      CODEISH_LINE_END.test(trimmedRight) ||
      CODEISH_INDENT.test(line) ||
      CODEISH_INLINE.test(line) ||
      CODEISH_KEYWORD.test(line);
    if (isCodeish) codeishCount++;
  }

  return codeishCount >= 2 && codeishCount / nonEmpty.length >= 0.6;
}
