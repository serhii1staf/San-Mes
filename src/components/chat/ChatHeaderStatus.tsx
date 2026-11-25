/**
 * The second line of the chat header: the other person's @username.
 *
 * ── «ПЕЧАТАЕТ…» IS SHOWN ONCE, ABOVE THE FIELD (Nov 2026) ──────────────────────────────────────
 *
 * This line used to turn into «печатает…» while the other person typed, at the same moment as the
 * typing pill above the composer (`TypingIndicator`) appeared: two indicators for one event. Asked
 * for: keep only the one above the field. So this line no longer listens to typing at all, which
 * also drops its own realtime subscription to the chat's typing channel (the pill keeps its own).
 *
 * There is deliberately no «в сети» / «был(а) недавно». The app has no presence data, and a fixed
 * «был(а) недавно» would be a status that is not true (`ChatPeekMenu` removed one for that reason).
 * Real presence is new data about every user (when they are online), so it needs the owner's
 * decision, a privacy-policy update and a server change first.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { Text } from '../ui/Text';

interface ChatHeaderStatusProps {
  username: string;
  color: string;
}

function ChatHeaderStatusImpl({ username, color }: ChatHeaderStatusProps) {
  if (!username) return null;
  return (
    <Text variant="caption" numberOfLines={1} color={color} style={styles.status}>
      {`@${username}`}
    </Text>
  );
}

const styles = StyleSheet.create({
  status: { fontSize: 12, lineHeight: 15, flexShrink: 1 },
});

export const ChatHeaderStatus = React.memo(ChatHeaderStatusImpl);
