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
  content: string;
  imageUrl?: string;
  imageUrls?: string[];
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
  senderId: string;
  text: string;
  createdAt: string;
  isRead: boolean;
}

export interface Conversation {
  id: string;
  participantId: string;
  participantName: string;
  participantUsername: string;
  participantAvatar?: string;
  participantEmoji?: string;
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
