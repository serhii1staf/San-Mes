import { User, Post, Comment, ChatMessage, Conversation, Story } from '../types';

export const mockUsers: User[] = [
  {
    id: '1',
    username: 'sophia_chen',
    displayName: 'Sophia Chen',
    emoji: '🌸',
    bio: 'Designer & coffee enthusiast. Making the world prettier one pixel at a time.',
    website: 'https://sophiachen.design',
    postsCount: 142,
    followersCount: 3280,
    followingCount: 891,
    isFollowing: false,
    isPrivate: false,
  },
  {
    id: '2',
    username: 'alex_woods',
    displayName: 'Alex Woods',
    emoji: '🌿',
    bio: 'Nature photographer. Capturing moments that matter.',
    website: 'https://alexwoods.photo',
    postsCount: 87,
    followersCount: 5620,
    followingCount: 312,
    isFollowing: true,
    isPrivate: false,
  },
  {
    id: '3',
    username: 'mia_jackson',
    displayName: 'Mia Jackson',
    emoji: '🦋',
    bio: 'Chef & food stylist. Turning ingredients into art.',
    postsCount: 203,
    followersCount: 12400,
    followingCount: 445,
    isFollowing: true,
    isPrivate: false,
  },
  {
    id: '4',
    username: 'james_riley',
    displayName: 'James Riley',
    emoji: '🌙',
    bio: 'Minimalist. Traveler. Storyteller.',
    postsCount: 56,
    followersCount: 1890,
    followingCount: 234,
    isFollowing: false,
    isPrivate: false,
  },
  {
    id: '5',
    username: 'emma_liu',
    displayName: 'Emma Liu',
    emoji: '✨',
    bio: 'Yoga instructor & wellness advocate. Breathe deeply.',
    postsCount: 178,
    followersCount: 8900,
    followingCount: 567,
    isFollowing: true,
    isPrivate: false,
  },
  {
    id: '6',
    username: 'oliver_park',
    displayName: 'Oliver Park',
    emoji: '🎵',
    bio: 'Musician & producer. Sound is my language.',
    postsCount: 94,
    followersCount: 4200,
    followingCount: 380,
    isFollowing: false,
    isPrivate: false,
  },
];

export const currentUser: User = {
  id: 'current',
  username: 'you_here',
  displayName: 'Your Name',
  emoji: '😊',
  bio: 'Living my best life. Sharing moments that spark joy.',
  website: 'https://mywebsite.com',
  postsCount: 34,
  followersCount: 1247,
  followingCount: 523,
  isPrivate: false,
};

export const mockPosts: Post[] = [
  {
    id: 'p1',
    authorId: '2',
    authorName: 'Alex Woods',
    authorUsername: 'alex_woods',
    authorEmoji: '🌿',
    content: 'Golden hour in the forest today. Sometimes the best moments are the quietest ones.',
    imageUrl: 'https://picsum.photos/seed/forest/800/600',
    likesCount: 234,
    commentsCount: 18,
    sharesCount: 12,
    isLiked: false,
    isBookmarked: false,
    createdAt: '2024-01-15T17:30:00Z',
  },
  {
    id: 'p2',
    authorId: '3',
    authorName: 'Mia Jackson',
    authorUsername: 'mia_jackson',
    authorEmoji: '🦋',
    content: 'New recipe alert! This sourdough took 3 days but every minute was worth it. The crust alone...',
    imageUrl: 'https://picsum.photos/seed/bread/800/800',
    likesCount: 567,
    commentsCount: 45,
    sharesCount: 89,
    isLiked: true,
    isBookmarked: true,
    createdAt: '2024-01-15T14:00:00Z',
  },
  {
    id: 'p3',
    authorId: '1',
    authorName: 'Sophia Chen',
    authorUsername: 'sophia_chen',
    authorEmoji: '🌸',
    content: 'Redesigned my workspace this weekend. Minimalism with warmth - that is the goal. What do you think?',
    imageUrl: 'https://picsum.photos/seed/desk/800/600',
    likesCount: 189,
    commentsCount: 24,
    sharesCount: 7,
    isLiked: false,
    isBookmarked: false,
    createdAt: '2024-01-15T10:15:00Z',
  },
  {
    id: 'p4',
    authorId: '5',
    authorName: 'Emma Liu',
    authorUsername: 'emma_liu',
    authorEmoji: '✨',
    content: 'Morning meditation by the lake. Stillness teaches you more than any book ever could. Take a pause today.',
    likesCount: 412,
    commentsCount: 32,
    sharesCount: 56,
    isLiked: true,
    isBookmarked: false,
    createdAt: '2024-01-14T06:30:00Z',
  },
  {
    id: 'p5',
    authorId: '4',
    authorName: 'James Riley',
    authorUsername: 'james_riley',
    authorEmoji: '🌙',
    content: 'Packed everything into one backpack. Next stop: unknown. That is the beauty of it.',
    imageUrl: 'https://picsum.photos/seed/travel/800/1000',
    likesCount: 890,
    commentsCount: 67,
    sharesCount: 134,
    isLiked: false,
    isBookmarked: true,
    createdAt: '2024-01-13T20:00:00Z',
  },
  {
    id: 'p6',
    authorId: '6',
    authorName: 'Oliver Park',
    authorUsername: 'oliver_park',
    authorEmoji: '🎵',
    content: 'New track dropping next week. Been working on this one for months. The bass line alone took 47 tries.',
    likesCount: 321,
    commentsCount: 28,
    sharesCount: 19,
    isLiked: false,
    isBookmarked: false,
    createdAt: '2024-01-13T15:45:00Z',
  },
];

export const mockComments: Comment[] = [
  {
    id: 'c1',
    postId: 'p1',
    authorId: '1',
    authorName: 'Sophia Chen',
    content: 'This is absolutely stunning! The light is perfect.',
    likesCount: 12,
    isLiked: false,
    createdAt: '2024-01-15T18:00:00Z',
  },
  {
    id: 'c2',
    postId: 'p1',
    authorId: '5',
    authorName: 'Emma Liu',
    content: 'Nature really is the best artist.',
    likesCount: 8,
    isLiked: true,
    createdAt: '2024-01-15T18:30:00Z',
  },
  {
    id: 'c3',
    postId: 'p2',
    authorId: '4',
    authorName: 'James Riley',
    content: 'Share the recipe please! That crust looks incredible.',
    likesCount: 24,
    isLiked: false,
    createdAt: '2024-01-15T14:30:00Z',
  },
];

export const mockConversations: Conversation[] = [
  {
    id: 'conv1',
    participantId: '1',
    participantName: 'Sophia Chen',
    participantUsername: 'sophia_chen',
    participantEmoji: '🌸',
    lastMessage: 'That design looks amazing! Let me know if you need feedback.',
    lastMessageAt: '2024-01-15T16:45:00Z',
    unreadCount: 2,
    isOnline: true,
  },
  {
    id: 'conv2',
    participantId: '2',
    participantName: 'Alex Woods',
    participantUsername: 'alex_woods',
    participantEmoji: '🌿',
    lastMessage: 'Thanks! I will send you the full resolution version.',
    lastMessageAt: '2024-01-15T14:20:00Z',
    unreadCount: 0,
    isOnline: false,
  },
  {
    id: 'conv3',
    participantId: '3',
    participantName: 'Mia Jackson',
    participantUsername: 'mia_jackson',
    participantEmoji: '🦋',
    lastMessage: 'Dinner at 7? I am trying a new recipe.',
    lastMessageAt: '2024-01-15T12:00:00Z',
    unreadCount: 1,
    isOnline: true,
  },
  {
    id: 'conv4',
    participantId: '5',
    participantName: 'Emma Liu',
    participantUsername: 'emma_liu',
    participantEmoji: '✨',
    lastMessage: 'See you at the class tomorrow morning!',
    lastMessageAt: '2024-01-14T22:30:00Z',
    unreadCount: 0,
    isOnline: false,
  },
  {
    id: 'conv5',
    participantId: '6',
    participantName: 'Oliver Park',
    participantUsername: 'oliver_park',
    participantEmoji: '🎵',
    lastMessage: 'Check out this beat I just made',
    lastMessageAt: '2024-01-14T19:15:00Z',
    unreadCount: 0,
    isOnline: true,
  },
];

export const mockMessages: Record<string, ChatMessage[]> = {
  conv1: [
    {
      id: 'm1',
      conversationId: 'conv1',
      senderId: '1',
      text: 'Hey! How is the new project going?',
      createdAt: '2024-01-15T15:00:00Z',
      isRead: true,
    },
    {
      id: 'm2',
      conversationId: 'conv1',
      senderId: 'current',
      text: 'Really well! Just finished the first draft of the designs.',
      createdAt: '2024-01-15T15:05:00Z',
      isRead: true,
    },
    {
      id: 'm3',
      conversationId: 'conv1',
      senderId: '1',
      text: 'Oh nice! Can I see them?',
      createdAt: '2024-01-15T15:10:00Z',
      isRead: true,
    },
    {
      id: 'm4',
      conversationId: 'conv1',
      senderId: 'current',
      text: 'Sure! Let me export them and send over.',
      createdAt: '2024-01-15T16:30:00Z',
      isRead: true,
    },
    {
      id: 'm5',
      conversationId: 'conv1',
      senderId: '1',
      text: 'That design looks amazing! Let me know if you need feedback.',
      createdAt: '2024-01-15T16:45:00Z',
      isRead: false,
    },
  ],
  conv2: [
    {
      id: 'm6',
      conversationId: 'conv2',
      senderId: 'current',
      text: 'Loved your latest photo! Where was that taken?',
      createdAt: '2024-01-15T13:00:00Z',
      isRead: true,
    },
    {
      id: 'm7',
      conversationId: 'conv2',
      senderId: '2',
      text: 'It was at Muir Woods, early morning light.',
      createdAt: '2024-01-15T13:45:00Z',
      isRead: true,
    },
    {
      id: 'm8',
      conversationId: 'conv2',
      senderId: 'current',
      text: 'Can I use it as my wallpaper? It is gorgeous.',
      createdAt: '2024-01-15T14:00:00Z',
      isRead: true,
    },
    {
      id: 'm9',
      conversationId: 'conv2',
      senderId: '2',
      text: 'Thanks! I will send you the full resolution version.',
      createdAt: '2024-01-15T14:20:00Z',
      isRead: true,
    },
  ],
  conv3: [
    {
      id: 'm10',
      conversationId: 'conv3',
      senderId: '3',
      text: 'Are you free tonight?',
      createdAt: '2024-01-15T11:30:00Z',
      isRead: true,
    },
    {
      id: 'm11',
      conversationId: 'conv3',
      senderId: 'current',
      text: 'Yes! What did you have in mind?',
      createdAt: '2024-01-15T11:45:00Z',
      isRead: true,
    },
    {
      id: 'm12',
      conversationId: 'conv3',
      senderId: '3',
      text: 'Dinner at 7? I am trying a new recipe.',
      createdAt: '2024-01-15T12:00:00Z',
      isRead: false,
    },
  ],
};

export const mockStories: Story[] = [
  {
    id: 's1',
    userId: 'current',
    userName: 'Your Story',
    userEmoji: '😊',
    isSeen: true,
  },
  {
    id: 's2',
    userId: '1',
    userName: 'Sophia',
    userEmoji: '🌸',
    isSeen: false,
  },
  {
    id: 's3',
    userId: '2',
    userName: 'Alex',
    userEmoji: '🌿',
    isSeen: false,
  },
  {
    id: 's4',
    userId: '3',
    userName: 'Mia',
    userEmoji: '🦋',
    isSeen: true,
  },
  {
    id: 's5',
    userId: '5',
    userName: 'Emma',
    userEmoji: '✨',
    isSeen: false,
  },
  {
    id: 's6',
    userId: '6',
    userName: 'Oliver',
    userEmoji: '🎵',
    isSeen: true,
  },
];

export const trendingTags = [
  'minimalism',
  'photography',
  'wellness',
  'cooking',
  'travel',
  'design',
  'music',
  'nature',
  'art',
  'mindfulness',
];

export const discoverCategories = [
  'All',
  'Photography',
  'Design',
  'Food',
  'Travel',
  'Wellness',
  'Music',
  'Art',
];

export function formatTimeAgo(dateString: string): string {
  const now = new Date();
  const date = new Date(dateString);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export function formatMessageTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatMessageDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / 86400000);

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
