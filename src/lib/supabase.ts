import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

const SUPABASE_URL = 'https://ycwadqglcykcpucembjn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inljd2FkcWdsY3lrY3B1Y2VtYmpuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4Mjc2OTYsImV4cCI6MjA5NTQwMzY5Nn0.ZUr1YfN6pBp_AaUC1pZLKGApwgEXEiVw_w6w-yQjE_U';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inljd2FkcWdsY3lrY3B1Y2VtYmpuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTgyNzY5NiwiZXhwIjoyMDk1NDAzNjk2fQ._fyRtcHahnaTL-SBYElzBOupPJk2u40yfjcbUwKQ43I';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: Platform.OS === 'web',
  },
});

// Storage client with service_role to bypass RLS for file uploads (buckets are public, content is non-secret)
const storageClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export { SUPABASE_URL, SUPABASE_ANON_KEY };

// Upload post image to storage, return public URL
export async function uploadPostImage(imageUri: string): Promise<{ url: string | null; error: string | null }> {
  try {
    const filename = `post_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.jpg`;
    
    // Use FormData approach which works correctly in React Native
    const formData = new FormData();
    formData.append('', {
      uri: imageUri,
      name: filename,
      type: 'image/jpeg',
    } as any);

    const uploadUrl = `${SUPABASE_URL}/storage/v1/object/post-images/${filename}`;
    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'x-upsert': 'true',
      },
      body: formData,
    });

    if (!response.ok) {
      const errText = await response.text();
      return { url: null, error: `Upload failed: ${errText}` };
    }
    
    const { data } = supabase.storage.from('post-images').getPublicUrl(filename);
    return { url: data.publicUrl, error: null };
  } catch (e: any) {
    return { url: null, error: e?.message || 'Unknown error' };
  }
}

// ---- Image URL helpers ----

const IMAGE_URL_SEPARATOR = '|';

/** Parse pipe-separated image URLs from the image_url column. Backward compatible with single URLs. */
export function parseImageUrls(imageUrl: string | null | undefined): string[] {
  if (!imageUrl) return [];
  return imageUrl.split(IMAGE_URL_SEPARATOR).filter(Boolean);
}

/** Join multiple image URLs into a pipe-separated string for storage. */
export function joinImageUrls(urls: string[]): string {
  return urls.join(IMAGE_URL_SEPARATOR);
}

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

// Repost marker prefix
const REPOST_PREFIX = '::repost::';

// Check if a post is a repost
export function isRepost(content: string): { isRepost: boolean; originalPostId?: string; comment?: string } {
  if (content.startsWith(REPOST_PREFIX)) {
    const rest = content.slice(REPOST_PREFIX.length);
    const sepIdx = rest.indexOf('::');
    if (sepIdx >= 0) {
      return { isRepost: true, originalPostId: rest.slice(0, sepIdx), comment: rest.slice(sepIdx + 2) || undefined };
    }
    return { isRepost: true, originalPostId: rest };
  }
  return { isRepost: false };
}

// Create a repost
export async function createRepost(authorId: string, originalPostId: string, comment?: string): Promise<{ post: DBPost | null; error: string | null }> {
  const content = `${REPOST_PREFIX}${originalPostId}::${comment || ''}`;
  const { data, error } = await supabase
    .from('posts')
    .insert({ author_id: authorId, content, image_url: null })
    .select()
    .single();
  if (error) return { post: null, error: error.message };
  // Increment shares_count on original post
  const { data: orig } = await supabase.from('posts').select('shares_count').eq('id', originalPostId).single();
  if (orig) {
    await supabase.from('posts').update({ shares_count: (orig.shares_count || 0) + 1 }).eq('id', originalPostId);
  }
  return { post: data, error: null };
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
export async function getPosts(limit: number = 20, offset: number = 0): Promise<{ posts: any[]; error: string | null; hasMore: boolean }> {
  const { data, error } = await supabase
    .from('posts')
    .select(`
      *,
      profiles:author_id (id, username, display_name, emoji)
    `)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) return { posts: [], error: error.message, hasMore: false };
  return { posts: data || [], error: null, hasMore: (data || []).length === limit };
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

// Delete a post
export async function deletePost(postId: string, authorId: string): Promise<{ error: string | null }> {
  try {
    // Delete related likes and comments first
    await supabase.from('likes').delete().eq('post_id', postId);
    await supabase.from('comments').delete().eq('post_id', postId);
    // Delete the post itself (only if author matches)
    const { error } = await supabase
      .from('posts')
      .delete()
      .eq('id', postId)
      .eq('author_id', authorId);
    return { error: error?.message || null };
  } catch (e: any) {
    return { error: e?.message || 'Unknown error' };
  }
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

// Update profile (basic fields in DB — including banner_url and links)
export async function updateProfile(userId: string, updates: Partial<{ display_name: string; emoji: string; bio: string; banner_url: string; links: any }>): Promise<{ error: string | null }> {
  const payload: any = { ...updates, updated_at: new Date().toISOString() };
  try {
    const { error } = await supabase
      .from('profiles')
      .update(payload)
      .eq('id', userId);
    return { error: error?.message || null };
  } catch (e: any) {
    return { error: e?.message || 'Unknown error' };
  }
}

// ---- Profile Meta — now stored directly in profiles table ----

export interface ProfileMeta {
  banner_url?: string;
  links?: { type: string; url: string }[];
}

// Save profile meta (writes banner_url and links to profiles table)
export async function saveProfileMeta(userId: string, meta: ProfileMeta): Promise<{ error: string | null }> {
  const payload: any = { updated_at: new Date().toISOString() };
  if (meta.banner_url !== undefined) payload.banner_url = meta.banner_url;
  if (meta.links !== undefined) payload.links = meta.links;
  try {
    const { error } = await supabase
      .from('profiles')
      .update(payload)
      .eq('id', userId);
    return { error: error?.message || null };
  } catch (e: any) {
    return { error: e?.message || 'Unknown error' };
  }
}

// Load profile meta from profiles table
export async function loadProfileMeta(userId: string): Promise<{ meta: ProfileMeta | null; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('banner_url, links')
      .eq('id', userId)
      .single();
    if (error || !data) return { meta: null, error: null };
    return { meta: { banner_url: data.banner_url || undefined, links: data.links || undefined }, error: null };
  } catch (e: any) {
    return { meta: null, error: null };
  }
}

// Upload banner image to storage, return public URL
export async function uploadBanner(userId: string, imageUri: string): Promise<{ url: string | null; error: string | null }> {
  try {
    const ext = imageUri.includes('.png') ? 'png' : 'jpg';
    const path = `banners/${userId}.${ext}`;
    const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';
    
    // Use FormData approach which works correctly in React Native
    const formData = new FormData();
    formData.append('', {
      uri: imageUri,
      name: `${userId}.${ext}`,
      type: mimeType,
    } as any);

    // Upload using fetch directly to Supabase Storage API (service_role for RLS bypass)
    const uploadUrl = `${SUPABASE_URL}/storage/v1/object/avatars/${path}`;
    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'x-upsert': 'true',
      },
      body: formData,
    });

    if (!response.ok) {
      const errText = await response.text();
      return { url: null, error: `Upload failed: ${errText}` };
    }
    
    const { data } = supabase.storage.from('avatars').getPublicUrl(path);
    // Add cache-busting param to force reload
    const publicUrl = data.publicUrl + '?t=' + Date.now();
    return { url: publicUrl, error: null };
  } catch (e: any) {
    return { url: null, error: e?.message || 'Unknown error' };
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
  try {
    // Check if already liked
    const { data: existing } = await supabase
      .from('likes')
      .select('*')
      .eq('user_id', userId)
      .eq('post_id', postId)
      .maybeSingle();

    if (existing) {
      // Unlike
      await supabase.from('likes').delete().eq('user_id', userId).eq('post_id', postId);
      // Decrement likes_count directly
      const { data: post } = await supabase.from('posts').select('likes_count').eq('id', postId).single();
      if (post) {
        await supabase.from('posts').update({ likes_count: Math.max((post.likes_count || 0) - 1, 0) }).eq('id', postId);
      }
      return { liked: false, error: null };
    } else {
      // Like
      await supabase.from('likes').insert({ user_id: userId, post_id: postId });
      // Increment likes_count directly
      const { data: post } = await supabase.from('posts').select('likes_count').eq('id', postId).single();
      if (post) {
        await supabase.from('posts').update({ likes_count: (post.likes_count || 0) + 1 }).eq('id', postId);
      }
      return { liked: true, error: null };
    }
  } catch (e: any) {
    return { liked: false, error: e?.message || 'Unknown error' };
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
    // Increment comment count directly
    const { data: post } = await supabase.from('posts').select('comments_count').eq('id', postId).single();
    if (post) {
      await supabase.from('posts').update({ comments_count: (post.comments_count || 0) + 1 }).eq('id', postId);
    }
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
    const { data, error } = await supabase
      .from('follows')
      .select('follower_id')
      .eq('follower_id', followerId)
      .eq('following_id', followingId)
      .maybeSingle();
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
