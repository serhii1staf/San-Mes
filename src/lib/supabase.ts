import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

const SUPABASE_URL = 'https://ycwadqglcykcpucembjn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inljd2FkcWdsY3lrY3B1Y2VtYmpuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4Mjc2OTYsImV4cCI6MjA5NTQwMzY5Nn0.ZUr1YfN6pBp_AaUC1pZLKGApwgEXEiVw_w6w-yQjE_U';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: Platform.OS === 'web',
  },
});

export { SUPABASE_URL, SUPABASE_ANON_KEY };

// ---- Database API ----

export interface DBProfile {
  id: string;
  username: string;
  display_name: string;
  emoji: string;
  bio: string;
  pin_hash: string;
  device_key: string;
  created_at: string;
  updated_at: string;
}

export interface DBPost {
  id: string;
  author_id: string;
  content: string;
  image_url: string | null;
  likes_count: number;
  comments_count: number;
  shares_count: number;
  created_at: string;
}

// Simple hash for PIN (not cryptographically secure, but sufficient for demo)
function hashPin(pin: string): string {
  let hash = 0;
  const str = pin + 'san_salt_2024';
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

// Register a new user
export async function registerUser(params: {
  username: string;
  displayName: string;
  emoji: string;
  pin: string;
  deviceKey: string;
}): Promise<{ profile: DBProfile | null; error: string | null }> {
  const { data, error } = await supabase
    .from('profiles')
    .insert({
      username: params.username,
      display_name: params.displayName,
      emoji: params.emoji,
      pin_hash: hashPin(params.pin),
      device_key: params.deviceKey,
      bio: '',
    })
    .select()
    .single();

  if (error) {
    if (error.message.includes('duplicate') || error.message.includes('unique')) {
      return { profile: null, error: 'Это имя пользователя уже занято' };
    }
    return { profile: null, error: error.message };
  }

  return { profile: data, error: null };
}

// Login with device key + PIN
export async function loginUser(params: {
  deviceKey: string;
  pin: string;
}): Promise<{ profile: DBProfile | null; error: string | null }> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('device_key', params.deviceKey)
    .eq('pin_hash', hashPin(params.pin))
    .single();

  if (error || !data) {
    return { profile: null, error: 'Неверный ключ или код' };
  }

  return { profile: data, error: null };
}

// Login with just PIN (for same device — match any user with that pin hash)
export async function loginWithPin(pin: string): Promise<{ profile: DBProfile | null; error: string | null }> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('pin_hash', hashPin(pin))
    .limit(1)
    .single();

  if (error || !data) {
    return { profile: null, error: 'Неверный код' };
  }

  return { profile: data, error: null };
}

// Get all posts with author info
export async function getPosts(): Promise<{ posts: any[]; error: string | null }> {
  const { data, error } = await supabase
    .from('posts')
    .select(`
      *,
      profiles:author_id (id, username, display_name, emoji)
    `)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return { posts: [], error: error.message };
  return { posts: data || [], error: null };
}

// Create a post
export async function createPost(authorId: string, content: string, imageUrl?: string): Promise<{ post: DBPost | null; error: string | null }> {
  const { data, error } = await supabase
    .from('posts')
    .insert({
      author_id: authorId,
      content,
      image_url: imageUrl || null,
    })
    .select()
    .single();

  if (error) return { post: null, error: error.message };
  return { post: data, error: null };
}

// Get conversations for a user
export async function getConversations(userId: string): Promise<{ conversations: any[]; error: string | null }> {
  const { data, error } = await supabase
    .from('conversation_participants')
    .select(`
      conversation_id,
      conversations:conversation_id (id, created_at),
      profiles:user_id (id, username, display_name, emoji)
    `)
    .neq('user_id', userId);

  if (error) return { conversations: [], error: error.message };
  return { conversations: data || [], error: null };
}

// Get messages for a conversation
export async function getMessages(conversationId: string): Promise<{ messages: any[]; error: string | null }> {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  if (error) return { messages: [], error: error.message };
  return { messages: data || [], error: null };
}

// Send a message
export async function sendMessage(conversationId: string, senderId: string, text: string): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_id: senderId,
      text,
    });

  return { error: error?.message || null };
}

// Update profile (including links as jsonb)
export async function updateProfile(userId: string, updates: Partial<{ display_name: string; emoji: string; bio: string; links: any; banner_url: string }>): Promise<{ error: string | null }> {
  const payload: any = { ...updates, updated_at: new Date().toISOString() };
  // Ensure links is stored as JSON
  if (payload.links && typeof payload.links !== 'string') {
    payload.links = JSON.stringify(payload.links);
  }
  try {
    const { error } = await supabase
      .from('profiles')
      .update(payload)
      .eq('id', userId);

    if (error) {
      // If banner_url column doesn't exist, retry without it
      if (error.message?.includes('banner_url')) {
        const { banner_url, ...rest } = payload;
        const { error: retryError } = await supabase
          .from('profiles')
          .update(rest)
          .eq('id', userId);
        return { error: retryError?.message || null };
      }
      return { error: error.message };
    }
    return { error: null };
  } catch (e: any) {
    return { error: e?.message || 'Unknown error' };
  }
}

// Get profile by ID (for sync)
export async function getProfile(userId: string): Promise<{ profile: DBProfile | null; error: string | null }> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (error || !data) return { profile: null, error: error?.message || 'Not found' };
  return { profile: data, error: null };
}

// Toggle like
export async function toggleLike(userId: string, postId: string): Promise<{ liked: boolean; error: string | null }> {
  // Check if already liked
  const { data: existing } = await supabase
    .from('likes')
    .select('*')
    .eq('user_id', userId)
    .eq('post_id', postId)
    .single();

  if (existing) {
    // Unlike
    await supabase.from('likes').delete().eq('user_id', userId).eq('post_id', postId);
    await supabase.rpc('decrement_likes', { post_id: postId }).catch(() => {});
    return { liked: false, error: null };
  } else {
    // Like
    await supabase.from('likes').insert({ user_id: userId, post_id: postId });
    await supabase.rpc('increment_likes', { post_id: postId }).catch(() => {});
    return { liked: true, error: null };
  }
}

// Get all profiles (for search/discover)
export async function getProfiles(): Promise<{ profiles: DBProfile[]; error: string | null }> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return { profiles: [], error: error.message };
  return { profiles: data || [], error: null };
}



// Get comments for a post
export async function getComments(postId: string): Promise<{ comments: any[]; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('comments')
      .select(`*, profiles:author_id (id, username, display_name, emoji)`)
      .eq('post_id', postId)
      .order('created_at', { ascending: true });
    if (error) return { comments: [], error: error.message };
    return { comments: data || [], error: null };
  } catch (e: any) {
    return { comments: [], error: e?.message || 'Unknown error' };
  }
}

// Create a comment
export async function createComment(postId: string, authorId: string, content: string): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase
      .from('comments')
      .insert({ post_id: postId, author_id: authorId, content });
    if (error) return { error: error.message };
    // Increment comment count on post
    await supabase.rpc('increment_comments', { post_id: postId }).catch(() => {});
    return { error: null };
  } catch (e: any) {
    return { error: e?.message || 'Unknown error' };
  }
}

// Follow a user
export async function followUser(followerId: string, followingId: string): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase
      .from('follows')
      .insert({ follower_id: followerId, following_id: followingId });
    return { error: error?.message || null };
  } catch (e: any) {
    return { error: e?.message || 'Unknown error' };
  }
}

// Unfollow a user
export async function unfollowUser(followerId: string, followingId: string): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase
      .from('follows')
      .delete()
      .eq('follower_id', followerId)
      .eq('following_id', followingId);
    return { error: error?.message || null };
  } catch (e: any) {
    return { error: e?.message || 'Unknown error' };
  }
}

// Check if following
export async function isFollowing(followerId: string, followingId: string): Promise<boolean> {
  try {
    const { data } = await supabase
      .from('follows')
      .select('id')
      .eq('follower_id', followerId)
      .eq('following_id', followingId)
      .single();
    return !!data;
  } catch {
    return false;
  }
}

// Get follower/following counts
export async function getFollowCounts(userId: string): Promise<{ followers: number; following: number }> {
  try {
    const [{ count: followers }, { count: following }] = await Promise.all([
      supabase.from('follows').select('*', { count: 'exact', head: true }).eq('following_id', userId),
      supabase.from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', userId),
    ]);
    return { followers: followers || 0, following: following || 0 };
  } catch {
    return { followers: 0, following: 0 };
  }
}
