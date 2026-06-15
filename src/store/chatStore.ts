import { create } from 'zustand';
import { ChatMessage as Message, Conversation } from '../types';

export type { ChatMessage as Message, Conversation } from '../types';

interface ChatStoreState {
  conversations: Conversation[];
  messages: Record<string, Message[]>;
  isLoading: boolean;
  setConversations: (conversations: Conversation[]) => void;
  addConversation: (conversation: Conversation) => void;
  setMessages: (conversationId: string, messages: Message[]) => void;
  addMessage: (conversationId: string, message: Message) => void;
  markAsRead: (conversationId: string) => void;
  setLoading: (loading: boolean) => void;
}

export const useChatStore = create<ChatStoreState>()((set) => ({
  conversations: [],
  messages: {},
  isLoading: false,
  setConversations: (conversations) => set({ conversations }),
  addConversation: (conversation) =>
    set((state) => ({ conversations: [conversation, ...state.conversations] })),
  setMessages: (conversationId, messages) =>
    set((state) => ({ messages: { ...state.messages, [conversationId]: messages } })),
  addMessage: (conversationId, message) =>
    set((state) => {
      const existing = state.messages[conversationId] || [];
      // Dedup by id: never append a message whose id is already present.
      // This is the universal safety net against the chat duplication bug —
      // optimistic send, realtime echo, canonical-id reconcile re-keying and
      // cache merges can all try to add the same logical message. The send
      // path reconciles the optimistic client id (`m-<ts>`) to the server's
      // uuid so the server copy and the optimistic copy share an id and
      // collapse here instead of rendering twice.
      if (message?.id && existing.some((m) => m.id === message.id)) {
        return state;
      }
      return {
        messages: {
          ...state.messages,
          [conversationId]: [...existing, message],
        },
      };
    }),
  markAsRead: (conversationId) =>
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === conversationId ? { ...c, unreadCount: 0 } : c
      ),
    })),
  setLoading: (isLoading) => set({ isLoading }),
}));
