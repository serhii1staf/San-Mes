import React, { memo, useCallback, useMemo, useState } from 'react';
import { View, Pressable, FlatList, ActivityIndicator, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { Avatar } from './Avatar';
import { SlideUpSheet } from './SlideUpSheet';
import { VerifiedBadge } from './VerifiedBadge';
import { GlassBg, useLiquidGlassActive } from './LiquidGlass';
import { useEntityStore } from '../../services/entityStore';
import { useT } from '../../i18n/store';
import { showToast } from '../../store/toastStore';
import { triggerHaptic } from '../../utils/haptics';

/**
 * "Send this to someone" sheet — pick a person, forward a post into the chat with them.
 *
 * ── WHAT IT SENDS, AND WHY THAT CHOICE ──────────────────────────────────────
 *
 * A LINK to the post, not a copy of its content.
 *
 * A copy would look richer for about a day and then be wrong: edit the post, delete it, add a photo,
 * and every forwarded copy still shows the old thing with no way to know it is stale. A link stays the
 * post. And it costs nothing to render well here — the app already unfurls links into preview cards in
 * chat (`LinkPreview` + the `unfurl` endpoint), so the recipient sees a card with the author, text and
 * image, and tapping it opens the real post.
 *
 * ── WHERE THE PEOPLE COME FROM ──────────────────────────────────────────────
 *
 * Existing conversations, most-recent first. There is no activity tracking in this app and adding a
 * per-user "last seen" table for a share sheet would be a lot of new surface (and new data collected)
 * for a list of fifteen names. "People you have talked to recently" is what the user means by recent,
 * and the conversation list already knows it exactly.
 *
 * ── HORIZONTAL, DELIBERATELY ────────────────────────────────────────────────
 *
 * A vertical list of names would push the buttons off a short sheet and turn a two-tap action into a
 * scroll-hunt. Horizontal keeps the whole sheet at a fixed height: the row of faces, then the actions,
 * always in the same place.
 */

/** How many people to offer. Fifteen fills several swipes without making the row a search problem. */
const MAX_PEOPLE = 15;

export interface ShareToChatSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Absolute URL of the thing being shared. Sent verbatim so it unfurls on the other side. */
  shareUrl: string;
  /** Optional line sent above the link — the post's own text, when there is one. */
  caption?: string;
  /** Ids to leave out — normally the signed-in user. */
  excludeUserIds?: readonly (string | undefined)[];
}

interface Person {
  userId: string;
  name: string;
  username?: string;
  emoji?: string;
  verified?: boolean;
}

function ShareToChatSheetComponent({ visible, onClose, shareUrl, caption, excludeUserIds }: ShareToChatSheetProps) {
  const theme = useTheme();
  const t = useT();
  const glassActive = useLiquidGlassActive();
  const conversations = useEntityStore((s) => s.conversations);
  const [selected, setSelected] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const people = useMemo<Person[]>(() => {
    const excluded = new Set((excludeUserIds || []).filter(Boolean) as string[]);
    const rows = (conversations || []) as any[];
    return rows
      .filter((c) => c?.participantId && !excluded.has(c.participantId))
      // Most recently active conversation first. `lastMessageAt` is ISO-8601, so a string compare IS a
      // chronological compare and needs no Date parsing per row.
      .slice()
      .sort((a, b) => String(b?.lastMessageAt || '').localeCompare(String(a?.lastMessageAt || '')))
      .slice(0, MAX_PEOPLE)
      .map((c) => ({
        userId: c.participantId,
        name: c.participantName || c.participantUsername || 'User',
        username: c.participantUsername,
        emoji: c.participantEmoji,
        verified: !!c.participantVerified,
      }));
  }, [conversations, excludeUserIds]);

  const close = useCallback(() => {
    setSelected(null);
    setSending(false);
    onClose();
  }, [onClose]);

  const send = useCallback(async () => {
    if (!selected || sending) return;
    setSending(true);
    try {
      const { apiPost } = await import('../../services/apiClient');
      // Idempotent on the Worker: returns the existing one-to-one conversation when there is one,
      // otherwise creates it. So sharing to somebody you have never messaged works without a separate
      // "start chat" step.
      const { data: conv } = await apiPost<{ conversation_id: string }>('/v1/conversations', {
        otherUserId: selected,
      });
      const convId = conv?.conversation_id;
      if (!convId) {
        showToast(t('toast.error_generic'), 'alert-circle');
        return;
      }
      // Caption first, link last: the unfurled card renders under the text, which is the order every
      // messenger uses and the order the chat's own link preview expects.
      const body = caption?.trim() ? `${caption.trim()}\n${shareUrl}` : shareUrl;
      const { error } = await apiPost(`/v1/conversations/${encodeURIComponent(convId)}/messages`, {
        text: body,
      });
      if (error) {
        showToast(t('toast.error_generic'), 'alert-circle');
        return;
      }
      triggerHaptic('medium');
      showToast(t('share.sent', 'Отправлено'), 'check');
      close();
    } catch {
      showToast(t('toast.error_generic'), 'alert-circle');
    } finally {
      setSending(false);
    }
  }, [selected, sending, caption, shareUrl, t, close]);

  const renderPerson = useCallback(
    ({ item }: { item: Person }) => {
      const isSelected = selected === item.userId;
      return (
        <Pressable
          onPress={() => {
            triggerHaptic('selection');
            // Tapping the selected face clears it, so a mis-tap does not force a send.
            setSelected((prev) => (prev === item.userId ? null : item.userId));
          }}
          style={styles.person}
        >
          <View style={styles.avatarWrap}>
            <Avatar emoji={item.emoji || '😊'} name={item.name} size="md" tint />
            {/* The tick sits ON the avatar rather than replacing it, so the row never changes layout as
                selection moves — a shifting row under the finger is what makes pickers feel unreliable. */}
            {isSelected ? (
              <View style={[styles.tick, { backgroundColor: theme.colors.accent.primary }]}>
                <Feather name="check" size={12} color="#FFFFFF" />
              </View>
            ) : null}
          </View>
          <View style={styles.nameRow}>
            <Text variant="caption" numberOfLines={1} style={styles.name} color={isSelected ? theme.colors.accent.primary : theme.colors.text.secondary}>
              {item.name}
            </Text>
            {item.verified ? <VerifiedBadge size={9} /> : null}
          </View>
        </Pressable>
      );
    },
    [selected, theme.colors.accent.primary, theme.colors.text.secondary],
  );

  const keyExtractor = useCallback((p: Person) => p.userId, []);

  return (
    <SlideUpSheet visible={visible} onClose={close}>
      <View style={styles.header}>
        <Feather name="send" size={16} color={theme.colors.accent.primary} />
        <Text variant="body" weight="semibold" style={styles.headerLabel}>
          {t('share.title', 'Поделиться')}
        </Text>
      </View>

      {people.length === 0 ? (
        <View style={styles.empty}>
          <Text variant="caption" color={theme.colors.text.tertiary}>
            {t('share.no_chats', 'Пока некому отправить — начните переписку')}
          </Text>
        </View>
      ) : (
        <FlatList
          data={people}
          horizontal
          keyExtractor={keyExtractor}
          renderItem={renderPerson}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
          // Fifteen items at most, so the whole list is cheaper to mount than the virtualization
          // bookkeeping would be — but the window is still bounded in case the cap ever grows.
          initialNumToRender={6}
          maxToRenderPerBatch={4}
          windowSize={5}
        />
      )}

      <View style={styles.actions}>
        <Pressable onPress={close} style={[styles.btn, styles.btnFlat, { borderColor: theme.colors.border.light }]}>
          <Text variant="body" color={theme.colors.text.secondary}>{t('common.cancel')}</Text>
        </Pressable>
        <Pressable
          onPress={send}
          // Disabled until somebody is picked: a share button that does nothing when tapped reads as
          // broken, and one that sends to a default recipient is worse.
          disabled={!selected || sending}
          style={[
            styles.btn,
            glassActive ? null : { backgroundColor: selected ? theme.colors.accent.primary : theme.colors.background.tertiary },
            { opacity: selected && !sending ? 1 : 0.5 },
          ]}
        >
          {glassActive && selected ? (
            <GlassBg borderRadius={14} glassStyle="regular" interactive colorScheme={theme.isDark ? 'dark' : 'light'} tintColor={theme.colors.accent.primary + '55'} />
          ) : null}
          {sending ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text variant="body" weight="semibold" color={selected ? '#FFFFFF' : theme.colors.text.tertiary}>
              {t('share.send', 'Отправить')}
            </Text>
          )}
        </Pressable>
      </View>
    </SlideUpSheet>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingTop: 8, paddingBottom: 10 },
  headerLabel: { marginLeft: 8 },
  listContent: { paddingHorizontal: 14, paddingBottom: 6 },
  person: { width: 72, alignItems: 'center', marginHorizontal: 3 },
  avatarWrap: { width: 44, height: 44 },
  tick: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 6, maxWidth: 70 },
  name: { fontSize: 11, flexShrink: 1 },
  empty: { paddingHorizontal: 20, paddingVertical: 22, alignItems: 'center' },
  actions: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8 },
  btn: {
    flex: 1,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  btnFlat: { borderWidth: 1 },
});

/**
 * Memoized on primitives plus the two callbacks. The screens that host this sheet are heavy and
 * re-render often; without this the horizontal list would be handed fresh props on every one of those
 * renders while the sheet is open.
 */
export const ShareToChatSheet = memo(
  ShareToChatSheetComponent,
  (prev, next) =>
    prev.visible === next.visible &&
    prev.onClose === next.onClose &&
    prev.shareUrl === next.shareUrl &&
    prev.caption === next.caption &&
    prev.excludeUserIds === next.excludeUserIds,
);
