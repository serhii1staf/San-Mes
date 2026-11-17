import { create } from 'zustand';
import type { ChatPeekAction, ChatPeekAnchor, ChatPeekConversation } from '../components/chat/ChatPeekMenu';

/**
 * The one open chat-list peek menu, if any.
 *
 * The menu used to be a `Modal` mounted inside the held row. Two problems with that, both of which
 * read to the user as "on some chats the long-press does nothing":
 *
 *   • iOS presents an RN `Modal` from the view controller nearest to the host view. When that
 *     controller is already presenting (or still dismissing) something, UIKit drops the new
 *     presentation silently, while the Modal records itself as presented — so that row's menu stayed
 *     "open" but invisible, and every later long-press on it changed nothing.
 *   • A Modal inside a virtualised list cell lives and dies with the cell.
 *
 * Now the row only describes what to show, and `ChatPeekHost` (mounted once at the app root) draws it
 * as a plain overlay. `key` increments per open so a new long-press always mounts a fresh menu.
 */
export interface ChatPeekRequest {
  key: number;
  anchor: ChatPeekAnchor;
  conversation: ChatPeekConversation | null;
  actions: ChatPeekAction[];
  onSelect: (id: string) => void;
  onOpen?: () => void;
}

interface ChatPeekState {
  request: ChatPeekRequest | null;
  open: (req: Omit<ChatPeekRequest, 'key'>) => void;
  /** Clears only if `key` is still the open one, so a late close cannot kill a newer menu. */
  clear: (key: number) => void;
}

let nextKey = 1;

export const useChatPeekStore = create<ChatPeekState>((set, get) => ({
  request: null,
  open: (req) => set({ request: { ...req, key: nextKey++ } }),
  clear: (key) => {
    if (get().request?.key === key) set({ request: null });
  },
}));

export function openChatPeek<Id extends string>(req: {
  anchor: ChatPeekAnchor;
  conversation: ChatPeekConversation | null;
  actions: ChatPeekAction<Id>[];
  onSelect: (id: Id) => void;
  onOpen?: () => void;
}): void {
  useChatPeekStore.getState().open(req as unknown as Omit<ChatPeekRequest, 'key'>);
}
