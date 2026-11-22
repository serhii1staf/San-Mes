/**
 * The second line of the chat header: «печатает…» while the other person is typing, their @username
 * otherwise.
 *
 * Its own leaf with its own subscription, for the reason `TypingIndicator` is one: if the chat screen
 * subscribed, every "started / stopped typing" would re-render the transcript. Here it re-renders one
 * line of text.
 *
 * There is deliberately no «в сети» / «был(а) недавно». The app has no presence data, and a fixed
 * «был(а) недавно» would be a status that is not true (`ChatPeekMenu` removed one for that reason).
 * Real presence is new data about every user (when they are online), so it needs the owner's
 * decision, a privacy-policy update and a server change first.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { Text } from '../ui/Text';
import { useT } from '../../i18n/store';
import { useTypingPeers } from '../../services/realtime/typing';

interface ChatHeaderStatusProps {
  channelName: string | null;
  username: string;
  color: string;
  typingColor: string;
}

function ChatHeaderStatusImpl({ channelName, username, color, typingColor }: ChatHeaderStatusProps) {
  const t = useT();
  const typing = useTypingPeers(channelName).length > 0;
  const label = typing ? t('chat.header.typing') : username ? `@${username}` : '';
  if (!label) return null;
  return (
    <Text variant="caption" numberOfLines={1} color={typing ? typingColor : color} style={styles.status}>
      {label}
    </Text>
  );
}

const styles = StyleSheet.create({
  status: { fontSize: 12, lineHeight: 15, flexShrink: 1 },
});

export const ChatHeaderStatus = React.memo(ChatHeaderStatusImpl);
