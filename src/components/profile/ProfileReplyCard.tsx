import React, { memo, useMemo } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '../../theme';
import { Text, Avatar } from '../ui';
import { CachedImage } from '../ui/CachedImage';
import { FormattedText } from '../ui/FormattedText';
import { LinkPreview } from '../ui/LinkPreview';
import { VerifiedBadge } from '../ui/VerifiedBadge';
import { triggerHaptic } from '../../utils/haptics';
import { formatTimeAgo } from '../../utils/mockData';
import { extractFirstUrl } from '../../services/linkPreview';
import { parseGif } from '../../services/giphy';
import { useT } from '../../i18n/store';

// Profile "Replies" tab row.
//
// Shows a single reply the profile owner authored: a small parent-post
// snippet on top (author name + ~80 chars of original content, tappable
// to jump straight into that thread), an optional preview row for the
// parent post's first image / link, and the user's own reply text +
// timestamp underneath. Tapping anywhere on the card opens the parent
// post's comments screen so the reply lands in context.
//
// `FormattedText` renders both the parent snippet and the reply body so
// **bold**, *italic*, `code`, ||spoiler||, @mentions, #hashtags and
// http(s) links display the way they would in the real thread instead
// of leaking the raw markers. `numberOfLines` truncation still applies
// because FormattedText delegates to a single RN <Text> root.
//
// Markers from the comments storage scheme that need stripping for the
// preview text:
//   `::gif::{url}`            — GIF-only reply, no body text
//   `::re::{base64}::{body}`  — reply-to-reply, real text after second `::`
// These match the same rules used by `app/notifications.tsx` so the
// preview reads identically across both screens.

const GIF_TOKEN = '::gif::';
const REPLY_TOKEN = '::re::';
const REPOST_PREFIX = '::repost::';

function stripCommentTokens(text: string): string {
  if (!text) return '';
  let s = text;
  if (s.startsWith(REPLY_TOKEN)) {
    const idx = s.indexOf('::', REPLY_TOKEN.length);
    s = idx > 0 ? s.slice(idx + 2) : '';
  } else if (s.startsWith('::re:')) {
    // Legacy single-colon reply format: ::re:<b64>:<b64>[:<b64>]::<body>
    const idx = s.indexOf('::', 5);
    s = idx > 0 ? s.slice(idx + 2) : '';
  }
  if (s.startsWith(GIF_TOKEN)) return '';
  // Safety net: never leak a residual leading marker into the preview.
  if (s.trimStart().startsWith('::')) return '';
  return s.trim();
}

// Extract the reply BODY (what the user actually wrote), unwrapping the
// reply-to-reply quote token if present. The body may itself be a GIF
// marker (`::gif::{url}`), which `parseGif` then resolves to a URL. This
// is the same unwrap rule the comments screen uses via `parseReply`, so a
// GIF reply renders identically in the Replies tab and the thread.
function getReplyBody(text: string): string {
  if (!text) return '';
  if (text.startsWith(REPLY_TOKEN)) {
    const idx = text.indexOf('::', REPLY_TOKEN.length);
    if (idx > 0) return text.slice(idx + 2);
  }
  return text;
}

export interface ProfileReply {
  id: string;
  postId: string;
  content: string;
  createdAt: string;
  parentAuthorName: string;
  parentAuthorEmoji: string;
  parentAuthorVerified?: boolean;
  parentSnippet: string;
  /**
   * First image URL of the parent post, if any. When the parent is
   * itself a repost, the loader resolves the chain to the original
   * post and stores the original's image here so the preview reflects
   * what the user is actually replying to. Pipe-separated multi-image
   * posts collapse to the FIRST URL plus a `parentImageCount` for the
   * "+N" pill — same convention as the home feed.
   */
  parentImageUrl?: string;
  /** Total number of images on the parent post (for the +N pill). */
  parentImageCount?: number;
  /**
   * First http(s) URL detected in the parent post's text via
   * `extractFirstUrl`. Only used when the parent has no images — that's
   * the layout that fits without crowding the card.
   */
  parentLinkUrl?: string;
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 24,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
  },
  parentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 14,
    marginBottom: 8,
  },
  parentMeta: { flex: 1 },
  parentName: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  thumb: {
    width: 40,
    height: 40,
    borderRadius: 8,
    overflow: 'hidden',
  },
  thumbBadge: {
    position: 'absolute',
    right: -4,
    top: -4,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkPreviewRow: { marginBottom: 8, marginHorizontal: 4 },
  replyBody: { paddingHorizontal: 4 },
  replyGif: {
    width: 120,
    height: 120,
    borderRadius: 14,
    marginTop: 2,
    backgroundColor: 'rgba(127,127,127,0.12)',
  },
  timeText: { fontSize: 10, marginTop: 6 },
});

interface ProfileReplyCardProps {
  reply: ProfileReply;
}

function ProfileReplyCardBase({ reply }: ProfileReplyCardProps) {
  const theme = useTheme();
  const t = useT();

  const containerStyle = useMemo(
    () => [
      styles.container,
      {
        backgroundColor: theme.isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)',
        borderColor: theme.colors.border.light,
      },
    ],
    [theme.isDark, theme.colors.border.light],
  );

  const parentStyle = useMemo(
    () => [
      styles.parentRow,
      {
        backgroundColor: theme.isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)',
      },
    ],
    [theme.isDark],
  );

  const replyText = stripCommentTokens(reply.content);
  // Resolve a GIF the reply itself carries (GIF-only or a reply-to-reply
  // whose body is a GIF). Reuses the comments screen's `parseGif` so the
  // token contract stays in one place.
  const replyGifUrl = parseGif(getReplyBody(reply.content));

  // Image takes layout precedence — if the parent post has an image we
  // show that thumbnail and skip the (heavier) link preview, even when
  // the snippet text also contains a URL. This keeps the card compact
  // on dense reply lists. Falls back to extracting a URL from the
  // snippet only when no image exists.
  const showThumb = !!reply.parentImageUrl;
  const linkUrl = !showThumb
    ? reply.parentLinkUrl || extractFirstUrl(reply.parentSnippet)
    : null;
  const extraImages = Math.max(0, (reply.parentImageCount || 0) - 1);

  const openThread = () => {
    triggerHaptic('selection');
    router.push({ pathname: '/comments/[id]', params: { id: reply.postId } });
  };

  return (
    <Pressable onPress={openThread} style={containerStyle}>
      {/* Parent post mini-preview — author + truncated content + (if any)
          a 40×40 thumbnail of the original post's first image. Tappable
          via the outer Pressable; we don't add a second nested press
          target to avoid swallowing the parent press in some Android
          versions. */}
      <View style={parentStyle}>
        <Avatar emoji={reply.parentAuthorEmoji || '😊'} size="xs" />
        <View style={styles.parentMeta}>
          <View style={styles.parentName}>
            <Text variant="caption" weight="semibold" numberOfLines={1} style={{ fontSize: 11 }}>
              {reply.parentAuthorName}
            </Text>
            {reply.parentAuthorVerified ? <VerifiedBadge size={10} /> : null}
          </View>
          {reply.parentSnippet ? (
            <FormattedText
              numberOfLines={1}
              color={theme.colors.text.tertiary}
              style={{ fontSize: 11, marginTop: 1 }}
            >
              {reply.parentSnippet}
            </FormattedText>
          ) : (
            <Text
              variant="caption"
              color={theme.colors.text.tertiary}
              numberOfLines={1}
              style={{ fontSize: 11, marginTop: 1 }}
            >
              {t('profile.empty_section')}
            </Text>
          )}
        </View>
        {showThumb ? (
          <View style={[styles.thumb, { backgroundColor: theme.colors.border.light }]}>
            <CachedImage
              uri={reply.parentImageUrl as string}
              style={{ width: '100%', height: '100%' }}
              resizeMode="cover"
              proxyWidth={120}
              // Decorative chrome inside a denser list — same priority
              // hint as the home-feed link-preview thumbnails so the
              // image decoder doesn't queue these ahead of the user's
              // primary feed scroll work.
              priority="low"
            />
            {extraImages > 0 ? (
              <View
                style={[
                  styles.thumbBadge,
                  { backgroundColor: theme.colors.accent.primary, borderWidth: 1.5, borderColor: theme.colors.background.primary },
                ]}
              >
                <Text variant="caption" weight="bold" color="#FFFFFF" style={{ fontSize: 9, lineHeight: 11 }}>
                  +{extraImages}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}
        <Feather name="chevron-right" size={14} color={theme.colors.text.tertiary} />
      </View>

      {/* Compact link preview — only when the parent has no images.
          LinkPreview reuses its own per-URL metadata cache + image
          prefetch so we don't re-fetch on every reply card mount. */}
      {linkUrl ? (
        <View style={styles.linkPreviewRow}>
          <LinkPreview url={linkUrl} static />
        </View>
      ) : null}

      {/* The user's reply: an actual GIF preview when the reply is a GIF
          (rendered via CachedImage, which proxies giphy/R2 URLs), otherwise
          the reply text. FormattedText so **bold**, *italic*, `code`, and
          other markers render as styled text. */}
      <View style={styles.replyBody}>
        {replyGifUrl ? (
          <CachedImage
            uri={replyGifUrl}
            style={styles.replyGif}
            resizeMode="cover"
            proxyWidth={240}
            priority="low"
          />
        ) : (
          <FormattedText style={{ fontSize: 13, lineHeight: 18 }}>
            {replyText}
          </FormattedText>
        )}
        <Text variant="caption" color={theme.colors.text.tertiary} style={styles.timeText}>
          {formatTimeAgo(reply.createdAt)}
        </Text>
      </View>
    </Pressable>
  );
}

export const ProfileReplyCard = memo(
  ProfileReplyCardBase,
  (prev, next) =>
    prev.reply.id === next.reply.id &&
    prev.reply.content === next.reply.content &&
    prev.reply.parentSnippet === next.reply.parentSnippet &&
    prev.reply.parentImageUrl === next.reply.parentImageUrl &&
    prev.reply.parentImageCount === next.reply.parentImageCount &&
    prev.reply.parentLinkUrl === next.reply.parentLinkUrl,
);
