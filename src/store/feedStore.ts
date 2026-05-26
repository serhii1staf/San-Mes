import { create } from 'zustand';
import { Post } from '../types';

export type { Post } from '../types';

interface FeedStoreState {
  posts: Post[];
  isLoading: boolean;
  isRefreshing: boolean;
  hasMore: boolean;
  setPosts: (posts: Post[]) => void;
  addPost: (post: Post) => void;
  removePost: (postId: string) => void;
  toggleLike: (postId: string) => void;
  setLoading: (loading: boolean) => void;
  setRefreshing: (refreshing: boolean) => void;
}

export const useFeedStore = create<FeedStoreState>()((set) => ({
  posts: [],
  isLoading: false,
  isRefreshing: false,
  hasMore: true,
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
}));
