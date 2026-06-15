export interface User {
  id: string;
  username: string;
  displayName: string;
  emoji?: string;
  avatar?: string;
  bio?: string;
  website?: string;
  postsCount: number;
  followersCount: number;
  followingCount: number;
  isFollowing?: boolean;
  isPrivate?: boolean;
}

export interface Post {
  id: string;
  authorId: string;
  authorName: string;
  authorUsername: string;
  authorAvatar?: string;
  authorEmoji?: string;
  authorBadge?: string;
  authorVerified?: boolean;
  content: string;
  imageUrl?: string;
  imageUrls?: string[];
  isSpoilerImage?: boolean;
  likesCount: number;
  commentsCount: number;
  sharesCount: number;
  isLiked: boolean;
  isBookmarked: boolean;
  createdAt: string;
  // Repost fields
  isRepost?: boolean;
  originalPost?: {
    id: string;
    authorName: string;
    authorUsername: string;
    authorEmoji?: string;
    authorBadge?: string;
    authorVerified?: boolean;
    content: string;
    imageUrl?: string;
    imageUrls?: string[];
  };
}

export interface Comment {
  id: string;
  postId: string;
  authorId: string;
  authorName: string;
  authorAvatar?: string;
  content: string;
  likesCount: number;
  isLiked: boolean;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  /** The REAL uuid of the message author. MUST always be a user uuid — never
   *  a relative sentinel like 'current' or 'peer'. Ownership ("is this mine",
   *  which side the bubble sits on) is computed at RENDER time as
   *  `senderId === currentUserId`, so a single device with multiple accounts
   *  renders every conversation correctly after switching accounts. */
  senderId: string;
  text: string;
  createdAt: string;
  isRead: boolean;
  replyToId?: string;
  replyToText?: string;
  replyToIsOwn?: boolean;
  replyToImage?: string;
  /** Optional pixel-icon registry id attached to a reply (`pack-1/01_ghost_king`).
   *  Rendered as a small thumbnail in the reply preview block alongside
   *  the existing text/image preview. Set from the per-chat
   *  `chatSettings.replyPixelIcon` at compose time. */
  replyPixelIconId?: string;
  imageUrls?: string[];
}

export interface Conversation {
  id: string;
  participantId: string;
  participantName: string;
  participantUsername: string;
  participantAvatar?: string;
  participantEmoji?: string;
  participantVerified?: boolean;
  participantBadge?: string | null;
  lastMessage?: string;
  lastMessageAt?: string;
  unreadCount: number;
  isOnline?: boolean;
}

export interface Story {
  id: string;
  userId: string;
  userName: string;
  userAvatar?: string;
  userEmoji?: string;
  isSeen: boolean;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface ApiResponse<T> {
  data: T;
  success: boolean;
  message?: string;
}
