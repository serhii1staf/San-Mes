import { create } from 'zustand';
import { Post } from '../types';

export type { Post } from '../types';

interface EditingPost {
  id: string;
  content: string;
  imageUrl?: string;
  imageUrls?: string[];
}

interface FeedStoreState {
  posts: Post[];
  isLoading: boolean;
  isRefreshing: boolean;
  hasMore: boolean;
  pendingRepostId: string | null;
  editingPost: EditingPost | null;
  setPosts: (posts: Post[]) => void;
  addPost: (post: Post) => void;
  removePost: (postId: string) => void;
  toggleLike: (postId: string) => void;
  setLoading: (loading: boolean) => void;
  setRefreshing: (refreshing: boolean) => void;
  setPendingRepost: (postId: string | null) => void;
  setEditingPost: (post: EditingPost | null) => void;
}

export const useFeedStore = create<FeedStoreState>()((set) => ({
  posts: [],
  isLoading: false,
  isRefreshing: false,
  hasMore: true,
  pendingRepostId: null,
  editingPost: null,
  setPosts: (posts) => set({ posts }),
  addPost: (post) => set((state) => ({ posts: [post, ...state.posts] })),
  removePost: (postId) =>
    set((state) => ({ posts: state.posts.filter((p) => p.id !== postId) })),
  toggleLike: (postId) =>
    set((state) => ({
      posts: state.posts.map((p) =>
        p.id === postId
          ? { ...p, isLiked: !p.isLiked, likesCount: p.isLiked ? p.likesCount - 1 : p.likesCount + 1 }
          : p
      ),
    })),
  setLoading: (isLoading) => set({ isLoading }),
  setRefreshing: (isRefreshing) => set({ isRefreshing }),
  setPendingRepost: (pendingRepostId) => set({ pendingRepostId }),
  setEditingPost: (editingPost) => set({ editingPost }),
}));
