import React, { memo, useMemo } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '../../theme';
import { Text, Avatar } from '../ui';
import { VerifiedBadge } from '../ui/VerifiedBadge';
import { triggerHaptic } from '../../utils/haptics';
import { formatTimeAgo } from '../../utils/mockData';
import { useT } from '../../i18n/store';

// Profile "Replies" tab row.
//
// Shows a single reply the profile owner authored: a small parent-post
// snippet on top (author name + ~80 chars of original content, tappable
// to jump straight into that thread) and the user's own reply text +
// timestamp underneath. Tapping anywhere on the card opens the parent
// post's comments screen so the reply lands in context.
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
    if (idx > 0) s = s.slice(idx + 2);
  }
  if (s.startsWith(GIF_TOKEN)) return '';
  return s.trim();
}

function stripPostContent(text: string): string {
  if (!text) return '';
  // Reposts store `::repost::{originalId}::{comment}` — show only the
  // comment portion (or empty for bare reposts).
  if (text.startsWith(REPOST_PREFIX)) {
    const rest = text.slice(REPOST_PREFIX.length);
    const sepIdx = rest.indexOf('::');
    if (sepIdx >= 0) return rest.slice(sepIdx + 2);
    return '';
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
  replyBody: { paddingHorizontal: 4 },
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
  const isGifOnly = reply.content?.includes(GIF_TOKEN) && !replyText;

  const openThread = () => {
    triggerHaptic('selection');
    router.push({ pathname: '/comments/[id]', params: { id: reply.postId } });
  };

  return (
    <Pressable onPress={openThread} style={containerStyle}>
      {/* Parent post mini-preview — author + truncated content. Tappable
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
          <Text
            variant="caption"
            color={theme.colors.text.tertiary}
            numberOfLines={1}
            style={{ fontSize: 11, marginTop: 1 }}
          >
            {reply.parentSnippet || t('profile.empty_section')}
          </Text>
        </View>
        <Feather name="chevron-right" size={14} color={theme.colors.text.tertiary} />
      </View>

      {/* The user's reply text (or a "GIF" hint if the reply was a GIF
          with no caption). */}
      <View style={styles.replyBody}>
        {isGifOnly ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Feather name="image" size={12} color={theme.colors.text.tertiary} />
            <Text variant="caption" color={theme.colors.text.tertiary} style={{ fontSize: 12 }}>
              {t('notifications.tag_gif')}
            </Text>
          </View>
        ) : (
          <Text
            variant="body"
            numberOfLines={4}
            style={{ fontSize: 13, lineHeight: 18 }}
          >
            {replyText}
          </Text>
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
    prev.reply.parentSnippet === next.reply.parentSnippet,
);
