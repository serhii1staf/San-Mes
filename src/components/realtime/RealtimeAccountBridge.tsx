import { useEffect } from 'react';
import { useAuthStore } from '../../store/authStore';
import { useEntityStore } from '../../services/entityStore';
import { useChatStore } from '../../store/chatStore';
import { getRealtime, userNotificationsChannelName } from '../../services/realtime/ably';

// App-wide realtime bridge.
//
// Mounts once when the user is authenticated, opens a single Ably connection,
// and subscribes to the user's PERSONAL notifications channel
// (`user:<myId>:notifications`). This channel is how OTHER conversation
// screens reach this user — when someone sends a message to a chat that's
// not currently open on this device, the sender publishes both to the
// chat channel AND to the recipient's notifications channel, and the
// bridge picks it up here.
//
// Two event types handled:
//   - 'new_message'  → upsert conversation in entity store + bump unread
//                      counter on the messages tab
//   - 'new_conversation' → insert a fresh conversation entry so the chat
//                          appears in the recipient's list before they
//                          ever open it (Telegram-style)
//
// The bridge has zero rendered output — it's effects-only. Mounted once
// inside AuthNavigationGuard so it runs only when the user is logged in.
// Its connection is released by `disconnectRealtime()` (called from
// switchAccount) when the user logs out / switches accounts.
export function RealtimeAccountBridge(): null {
  const userId = useAuthStore((s) => s.user?.id || null);

  useEffect(() => {
    if (!userId) return;
    // Defer the Ably client construction + channel.subscribe past the
    // current RAF so the cold-open critical path (app shell paint →
    // first tab render) is never competing with the WebSocket handshake
    // that `new Ably.Realtime(...)` kicks off. The bridge mounts inside
    // AuthNavigationGuard at app shell, which lands on the same frame
    // as the (tabs)/index commit on a cold open — without this defer
    // the auth-callback fetch (`POST /api/ably-token`) and the
    // subsequent socket open both fire inline with the first tab's
    // mount, and the WebSocket setup steals UI thread time from the
    // navigation transition into whichever tab the user taps next.
    // 0 ms timeout (macrotask) is enough to push past the current
    // commit + RAF; the user can't perceive a 0–16 ms delay before
    // realtime starts listening, but they do feel the cold-open
    // freeze if it doesn't.
    let cancelled = false;
    let cleanup: (() => void) | null = null;

    const timer = setTimeout(() => {
      if (cancelled) return;
      const realtime = getRealtime();
      if (!realtime) return; // No deviceKey or auth not ready — degrade silently.

      const channel = realtime.channels.get(userNotificationsChannelName(userId));

      const onEvent = (msg: { name?: string; data?: any }) => {
        const payload = msg?.data;
        if (!payload || typeof payload !== 'object') return;

        if (msg.name === 'new_conversation' || msg.name === 'new_message') {
          const conversationId = String(payload.conversationId || '');
          if (!conversationId) return;

          // 1) Upsert the conversation row in the entity store so the
          //    messages tab shows it immediately. We use participantId as
          //    the dedupe key — we never want two rows for the same peer.
          try {
            const store = useEntityStore.getState();
            const existing = store.conversations || [];
            const idx = existing.findIndex(
              (c: any) =>
                c.id === conversationId ||
                (payload.senderId && c.participantId === payload.senderId),
            );
            const nextRow = {
              id: conversationId,
              participantId: String(payload.senderId || ''),
              participantName: String(payload.senderName || ''),
              participantUsername: String(payload.senderUsername || ''),
              participantEmoji: String(payload.senderEmoji || '😊'),
              lastMessage: String(payload.lastMessage || ''),
              lastMessageAt: String(payload.lastMessageAt || new Date().toISOString()),
            };
            if (idx >= 0) {
              const merged = [...existing];
              merged[idx] = { ...existing[idx], ...nextRow };
              store.setConversations(merged);
            } else {
              store.setConversations([nextRow, ...existing]);
            }
          } catch {}

          // 2) If the message body is on the payload, append it to the
          //    chat's local message store too. That way when the user
          //    opens the chat for the first time it already shows the
          //    incoming message — no spinner, no fetch round-trip.
          if (payload.message && payload.message.id) {
            try {
              const chatStore = useChatStore.getState();
              const existing = chatStore.messages[conversationId] || [];
              if (!existing.some((m: any) => m.id === payload.message.id)) {
                chatStore.addMessage(conversationId, {
                  id: String(payload.message.id),
                  conversationId,
                  senderId: 'peer',
                  text: String(payload.message.text || ''),
                  createdAt: String(payload.message.createdAt || new Date().toISOString()),
                  isRead: false,
                  imageUrls: Array.isArray(payload.message.imageUrls) ? payload.message.imageUrls : undefined,
                } as any);
              }
            } catch {}
          }
        }
      };

      void channel.subscribe(onEvent);
      cleanup = () => {
        try { channel.unsubscribe(onEvent); } catch {}
      };
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (cleanup) cleanup();
    };
  }, [userId]);

  return null;
}
