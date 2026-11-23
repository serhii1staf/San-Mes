import React, { memo, useCallback, useMemo, useState } from 'react';
import { View, Pressable, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { Text } from './Text';
import { Avatar } from './Avatar';
import { SlideUpSheet } from './SlideUpSheet';
import { VerifiedBadge } from './VerifiedBadge';
import { useEntityStore } from '../../services/entityStore';
import { useAuthStore } from '../../store/authStore';
import { useChatStore } from '../../store/chatStore';
import { filterTombstoned } from '../../services/messageTombstones';
import { CHAT_TAIL_ROWS, readChatDiskSeed } from '../../utils/chatDiskSeed';
import { useT } from '../../i18n/store';
import { showToast } from '../../store/toastStore';
import { triggerHaptic } from '../../utils/haptics';
import { compareIso } from '../../utils/compareIso';

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
 * ── THE LAYOUT (Nov 2026 redesign) ──────────────────────────────────────────
 *
 * Asked for: "более современный ... без лишних контейнеров". It had a bordered copy-link button in the
 * header, a horizontal strip of small faces, and two boxed buttons, Cancel and Send.
 *
 * Now it is a title, a grid of faces, and ONE action at the bottom, the way Telegram's sheet works: it
 * reads "Скопировать ссылку" while nobody is picked and becomes "Отправить" once someone is. Cancel is
 * gone because the sheet already closes from its backdrop and its grabber. A pick is an accent ring
 * around the face plus a small tick on the ring's edge, so the face itself is never covered. The grid
 * scrolls inside a fixed maximum height, so the sheet's size does not depend on how many people there
 * are.
 *
 * ── THE SENT MESSAGE IS IN THE CHAT AT ONCE ─────────────────────────────────
 *
 * Reported: after sending, the chat showed nothing; the message appeared a few seconds later. The
 * sheet posted the message and wrote nothing locally, so the chat could only learn about it from its
 * history request (which a recent reopen with realtime connected even skipped). Now the server's row
 * goes into the chat store, and the conversation's list row, as soon as the POST answers; see
 * `recordSentMessage`.
 */

/** How many people to offer. Fifteen fills a few rows without making the grid a search problem. */
const MAX_PEOPLE = 15;
const COLUMNS = 4;
/** Avatar 64 + ring. The cell is wider than this; the face is centred in it. */
const RING = 74;
/** A bit over two and a half rows, so a longer list visibly continues below. */
const GRID_MAX_H = 290;

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

/**
 * Put a message this device just sent (from outside the chat screen) into that chat, so opening the
 * chat shows it immediately.
 *
 * Same rule as the realtime bridge's backstop (RealtimeAccountBridge, "NEVER START A TRANSCRIPT FROM
 * A PING"): a bucket that does not exist yet is first filled from the disk tail, because the chat
 * screen treats a non-empty bucket as the whole transcript and would otherwise open on this one
 * message. `addMessage` then keeps the chat list's preview in step.
 */
function recordSentMessage(
  conversationId: string,
  peerId: string,
  row: { id?: unknown; text?: unknown; created_at?: unknown } | null | undefined,
  fallbackText: string,
): void {
  const myId = useAuthStore.getState().user?.id;
  if (!myId || !row || typeof row.id !== 'string' || !row.id) return;
  const createdAt = typeof row.created_at === 'string' ? row.created_at : new Date().toISOString();
  const text = typeof row.text === 'string' ? row.text : fallbackText;
  try {
    const chat = useChatStore.getState();
    let existing = chat.messages[conversationId] || [];
    if (existing.length === 0) {
      try {
        const tail = readChatDiskSeed<any>(conversationId, CHAT_TAIL_ROWS);
        if (tail.length > 0) {
          const healed = tail.map((m) => {
            if (m?.senderId === 'current') return { ...m, senderId: myId };
            if (m?.senderId === 'peer' && peerId) return { ...m, senderId: peerId };
            return m;
          });
          const kept = filterTombstoned(conversationId, healed) as any[];
          if (kept.length > 0) {
            chat.setMessages(conversationId, kept as any);
            existing = kept;
          }
        }
      } catch {}
    }
    if (!existing.some((m: any) => m.id === row.id || m.serverId === row.id)) {
      chat.addMessage(conversationId, {
        id: row.id,
        serverId: row.id,
        conversationId,
        senderId: myId,
        text,
        createdAt,
        isRead: true,
      } as any);
    }
  } catch {}
  // The chat list's own row: newest first, with us as the author (the unread logic reads that).
  try {
    const store = useEntityStore.getState();
    const rows = (store.conversations || []) as any[];
    const idx = rows.findIndex((c) => c?.id === conversationId);
    if (idx >= 0) {
      const next = rows.slice();
      next[idx] = { ...rows[idx], lastMessage: text, lastMessageAt: createdAt, lastSenderId: myId };
      store.setConversations(next as any);
    }
  } catch {}
}

const PersonCell = memo(function PersonCell({
  person,
  selected,
  onToggle,
  accent,
  ringGap,
  nameColor,
}: {
  person: Person;
  selected: boolean;
  onToggle: (userId: string) => void;
  accent: string;
  /** The sheet's own colour, for the tick's outline. */
  ringGap: string;
  nameColor: string;
}) {
  return (
    <Pressable
      onPress={() => onToggle(person.userId)}
      style={styles.cell}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={person.name}
    >
      {/* The ring is always laid out (transparent when unpicked), so picking moves nothing. */}
      <View style={[styles.ring, { borderColor: selected ? accent : 'transparent' }]}>
        <Avatar emoji={person.emoji || '😊'} name={person.name} size="lg" tint />
        {selected ? (
          <View style={[styles.tick, { backgroundColor: accent, borderColor: ringGap }]}>
            <Feather name="check" size={11} color="#FFFFFF" />
          </View>
        ) : null}
      </View>
      <View style={styles.nameRow}>
        <Text
          variant="caption"
          numberOfLines={1}
          weight={selected ? 'semibold' : undefined}
          color={selected ? accent : nameColor}
          style={styles.name}
        >
          {person.name}
        </Text>
        {person.verified ? <VerifiedBadge size={10} /> : null}
      </View>
    </Pressable>
  );
});

function ShareToChatSheetComponent({ visible, onClose, shareUrl, caption, excludeUserIds }: ShareToChatSheetProps) {
  const theme = useTheme();
  const t = useT();
  const conversations = useEntityStore((s) => s.conversations);
  const [selected, setSelected] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const accent = theme.colors.accent.primary;
  const sheetColor = theme.isDark ? theme.colors.background.elevated : '#FFFFFF';

  const people = useMemo<Person[]>(() => {
    const excluded = new Set((excludeUserIds || []).filter(Boolean) as string[]);
    const rows = (conversations || []) as any[];
    return rows
      .filter((c) => c?.participantId && !excluded.has(c.participantId))
      // Most recently active conversation first. `lastMessageAt` is ISO-8601, so a string compare IS a
      // chronological compare and needs no Date parsing per row.
      .slice()
      .sort((a, b) => compareIso(String(b?.lastMessageAt || ''), String(a?.lastMessageAt || '')))
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

  const toggle = useCallback((userId: string) => {
    triggerHaptic('selection');
    // Tapping the picked face clears it, so a mis-tap does not force a send.
    setSelected((prev) => (prev === userId ? null : userId));
  }, []);

  const copyLink = useCallback(async () => {
    if (!shareUrl) return;
    triggerHaptic('light');
    try {
      const Clipboard = await import('expo-clipboard');
      await Clipboard.setStringAsync(shareUrl);
      showToast(t('toast.link_copied'), 'link');
      close();
    } catch {
      showToast(t('toast.error_generic'), 'alert-circle');
    }
  }, [shareUrl, t, close]);

  const send = useCallback(async () => {
    if (!selected || sending) return;
    const peerId = selected;
    setSending(true);
    try {
      const { apiPost } = await import('../../services/apiClient');
      // Idempotent on the Worker: returns the existing one-to-one conversation when there is one,
      // otherwise creates it. So sharing to somebody you have never messaged works without a separate
      // "start chat" step.
      const { data: conv } = await apiPost<{ conversation_id: string }>('/v1/conversations', {
        otherUserId: peerId,
      });
      const convId = conv?.conversation_id;
      if (!convId) {
        showToast(t('toast.error_generic'), 'alert-circle');
        return;
      }
      // Caption first, link last: the unfurled card renders under the text, which is the order every
      // messenger uses and the order the chat's own link preview expects.
      // No URL means a forwarded message: the text alone, without a trailing newline.
      const text = caption?.trim() || '';
      const body = text && shareUrl ? `${text}\n${shareUrl}` : text || shareUrl;
      if (!body) return;
      const { data: sent, error } = await apiPost<{ id: string; text: string; created_at: string }>(
        `/v1/conversations/${encodeURIComponent(convId)}/messages`,
        { text: body },
      );
      if (error) {
        showToast(t('toast.error_generic'), 'alert-circle');
        return;
      }
      recordSentMessage(convId, peerId, sent, body);
      triggerHaptic('medium');
      showToast(t('share.sent', 'Отправлено'), 'check');
      close();
    } catch {
      showToast(t('toast.error_generic'), 'alert-circle');
    } finally {
      setSending(false);
    }
  }, [selected, sending, caption, shareUrl, t, close]);

  // One action. Picked somebody: send to them. Nobody yet: copy the link (when there is one; a
  // forwarded message has none, so it waits for a pick).
  const canAct = !sending && (!!selected || !!shareUrl);
  const actionIsSend = !!selected || !shareUrl;
  const actionLabel = actionIsSend ? t('share.send', 'Отправить') : t('post_menu.copy_link');
  const actionFilled = !!selected;

  return (
    <SlideUpSheet visible={visible} onClose={close}>
      <Text variant="body" weight="semibold" align="center" style={styles.title}>
        {t('share.title', 'Поделиться')}
      </Text>

      {people.length === 0 ? (
        <View style={styles.empty}>
          <Text variant="caption" color={theme.colors.text.tertiary} align="center">
            {t('share.no_chats', 'Пока некому отправить — начните переписку')}
          </Text>
        </View>
      ) : (
        <ScrollView
          style={{ maxHeight: GRID_MAX_H }}
          contentContainerStyle={styles.grid}
          showsVerticalScrollIndicator={false}
          // Fifteen cells at most: a plain map is cheaper than list virtualisation would be.
        >
          {people.map((p) => (
            <PersonCell
              key={p.userId}
              person={p}
              selected={selected === p.userId}
              onToggle={toggle}
              accent={accent}
              ringGap={sheetColor}
              nameColor={theme.colors.text.secondary}
            />
          ))}
        </ScrollView>
      )}

      <View style={styles.footer}>
        <Pressable
          onPress={actionIsSend ? send : copyLink}
          disabled={!canAct}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canAct }}
          style={({ pressed }) => [
            styles.action,
            {
              backgroundColor: actionFilled
                ? accent
                : theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
              opacity: canAct || sending ? (pressed ? 0.85 : 1) : 0.5,
            },
          ]}
        >
          {sending ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <View style={styles.actionRow}>
              <Feather
                name={actionIsSend ? 'send' : 'link'}
                size={17}
                color={actionFilled ? '#FFFFFF' : theme.colors.text.primary}
              />
              <Text variant="body" weight="semibold" color={actionFilled ? '#FFFFFF' : theme.colors.text.primary}>
                {actionLabel}
              </Text>
            </View>
          )}
        </Pressable>
      </View>
    </SlideUpSheet>
  );
}

const styles = StyleSheet.create({
  title: { paddingTop: 6, paddingBottom: 14 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 8 },
  cell: { width: `${100 / COLUMNS}%`, alignItems: 'center', paddingBottom: 14 },
  ring: {
    width: RING,
    height: RING,
    borderRadius: RING / 2,
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // On the ring's lower right edge, outside the face. Outlined in the sheet colour so it reads as
  // sitting on top of the ring rather than merging with it.
  tick: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 6, maxWidth: '90%' },
  name: { fontSize: 12, flexShrink: 1 },
  empty: { paddingHorizontal: 24, paddingVertical: 28, alignItems: 'center' },
  footer: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 6 },
  action: {
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});

/**
 * Memoized on primitives plus the two callbacks. The screens that host this sheet are heavy and
 * re-render often; without this the grid would be handed fresh props on every one of those renders
 * while the sheet is open.
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
