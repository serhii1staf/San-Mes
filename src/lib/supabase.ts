// Phase 5/6 of the Cloudflare D1 migration.
//
// This module used to be the canonical Supabase client + every read /
// write helper. Today the data layer is the san-mes Worker (D1 +
// custom JWTs) — every database function below delegates to
// `apiClient` (and `authClient` for auth flows). The Supabase JS
// client is still imported for one purpose only: as a `getPublicUrl()`
// formatter for legacy banner / post images that pre-date the R2
// migration. NO database queries go through it anymore.
//
// The function names + return shapes are unchanged so existing call
// sites compile without edits. Internally each function is now a
// 2-3 line wrapper around an apiClient call.

import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import { uploadToR2, isR2PublicConfigured } from './r2';
import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  apiPut,
} from '../services/apiClient';
import * as authClient from '../services/authClient';
import { perfMonitor } from '../services/perfMonitor';

// ─── Legacy Supabase clients ──────────────────────────────────────────
//
// Kept ONLY for storage uploads to existing buckets (`post-images`,
// `avatars`). When R2 is configured every new upload lands there
// first; the Supabase fallback survives so old image URLs keep
// resolving. There are NO database queries through this client.

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

const storageClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export { SUPABASE_URL, SUPABASE_ANON_KEY };

// ─── Image upload helpers (R2 primary, Supabase fallback) ────────────

/** Upload a chat image: aggressively compressed to keep files in KB. GIFs preserved. */
export async function uploadChatImage(imageUri: string): Promise<{ url: string | null; error: string | null }> {
  try {
    const ext = imageUri.split('.').pop()?.toLowerCase() || 'jpg';
    const isGif = ext === 'gif';
    let finalUri = imageUri;
    let contentType = 'image/jpeg';
    let fileExt = 'jpg';
    if (isGif) {
      contentType = 'image/gif';
      fileExt = 'gif';
    } else {
      try {
        const { manipulateAsync, SaveFormat } = await import('expo-image-manipulator');
        const result = await manipulateAsync(imageUri, [{ resize: { width: 1280 } }], { compress: 0.5, format: SaveFormat.JPEG });
        finalUri = result.uri;
      } catch {}
    }
    const filename = `chat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${fileExt}`;
    if (isR2PublicConfigured()) {
      const r2 = await uploadToR2(finalUri, `chat/${filename}`, contentType);
      if (r2.url) return { url: r2.url, error: null };
    }
    const formData = new FormData();
    formData.append('', { uri: finalUri, name: filename, type: contentType } as any);
    const uploadUrl = `${SUPABASE_URL}/storage/v1/object/post-images/${filename}`;
    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`, 'x-upsert': 'true' },
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

/** Upload post image to storage, return public URL. */
export async function uploadPostImage(imageUri: string): Promise<{ url: string | null; error: string | null }> {
  try {
    let finalUri = imageUri;
    let contentType = 'image/jpeg';
    let fileExt = 'jpg';
    const ext = imageUri.split('.').pop()?.toLowerCase() || 'jpg';
    if (ext === 'gif') {
      contentType = 'image/gif';
      fileExt = 'gif';
    } else {
      try {
        const { manipulateAsync, SaveFormat } = await import('expo-image-manipulator');
        const result = await manipulateAsync(imageUri, [{ resize: { width: 1280 } }], { compress: 0.5, format: SaveFormat.JPEG });
        finalUri = result.uri;
      } catch {}
    }
    const filename = `post_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${fileExt}`;
    if (isR2PublicConfigured()) {
      const r2 = await uploadToR2(finalUri, `post/${filename}`, contentType);
      if (r2.url) return { url: r2.url, error: null };
    }
    const formData = new FormData();
    formData.append('', { uri: finalUri, name: filename, type: contentType } as any);
    const uploadUrl = `${SUPABASE_URL}/storage/v1/object/post-images/${filename}`;
    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`, 'x-upsert': 'true' },
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

/** Upload a banner image. Preserves GIF / WebP animation. */
export async function uploadBanner(userId: string, imageUri: string): Promise<{ url: string | null; error: string | null }> {
  // Migrated to Cloudflare R2 — Supabase Storage was decommissioned during
  // the D1 migration, and the previous implementation was POSTing to a dead
  // bucket which is why other users never saw a saved banner. The R2 helper
  // streams the file through our Vercel function (no secrets in the bundle)
  // and returns a public pub-*.r2.dev URL that any client can read for
  // free — same path used by chat/post/avatar uploads.
  try {
    const lower = imageUri.toLowerCase();
    let ext: 'gif' | 'png' | 'webp' | 'jpg' = 'jpg';
    if (lower.endsWith('.gif') || lower.includes('.gif?')) ext = 'gif';
    else if (lower.endsWith('.png') || lower.includes('.png?')) ext = 'png';
    else if (lower.endsWith('.webp') || lower.includes('.webp?')) ext = 'webp';
    const { uploadToR2 } = await import('./r2');
    const { url, error } = await uploadToR2(imageUri, `banners/${userId}.${ext}`);
    if (!url) return { url: null, error: error || 'upload failed' };
    // Cache-bust so a re-upload to the same path doesn't render the stale
    // bitmap from the previous decode in this app session. Other clients
    // get a fresh URL via the server, so this only matters locally.
    return { url: `${url}?t=${Date.now()}`, error: null };
  } catch (e: any) {
    return { url: null, error: e?.message || 'Unknown error' };
  }
}

// ─── Image URL helpers ─────────────────────────────────────────────────

const IMAGE_URL_SEPARATOR = '|';
const SPOILER_PREFIX = '::spoiler::';

export function isImageSpoiler(imageUrl: string | null | undefined): boolean {
  return !!imageUrl && imageUrl.startsWith(SPOILER_PREFIX);
}

export function parseImageUrls(imageUrl: string | null | undefined): string[] {
  if (!imageUrl) return [];
  const clean = imageUrl.startsWith(SPOILER_PREFIX) ? imageUrl.slice(SPOILER_PREFIX.length) : imageUrl;
  return clean.split(IMAGE_URL_SEPARATOR).filter(Boolean);
}

export function joinImageUrls(urls: string[]): string {
  return urls.join(IMAGE_URL_SEPARATOR);
}

// ─── Types (unchanged) ─────────────────────────────────────────────────

export interface DBProfile {
  id: string;
  username: string;
  display_name: string;
  emoji: string;
  bio: string;
  pin_hash: string;
  device_key: string;
  banner_url?: string | null;
  theme_id?: string | null;
  links?: { type: string; url: string }[] | null;
  badge?: string | null;
  is_verified?: boolean;
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

const REPOST_PREFIX = '::repost::';

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

// ─── Auth shims (delegate to authClient) ─────────────────────────────

/**
 * Mirror of the server-side hashPin — kept for backwards compat with
 * any cached payloads that include a pre-computed hash. New auth flows
 * pass the raw PIN to the Worker and let it hash there.
 */
export function hashPin(pin: string): string {
  let hash = 0;
  const str = pin + 'san_salt_2024';
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

export async function registerUser(params: {
  username: string;
  displayName: string;
  emoji: string;
  pin: string;
  deviceKey: string;
}): Promise<{ profile: DBProfile | null; error: string | null }> {
  const { profile, error } = await authClient.register(params);
  return { profile: profile as DBProfile | null, error };
}

export async function loginUser(params: {
  deviceKey: string;
  pin: string;
}): Promise<{ profile: DBProfile | null; error: string | null }> {
  const { profile, error } = await authClient.login(params);
  return { profile: profile as DBProfile | null, error };
}

export async function loginWithPin(pin: string): Promise<{ profile: DBProfile | null; error: string | null }> {
  const { profile, error } = await authClient.loginWithPin(pin);
  return { profile: profile as DBProfile | null, error };
}

export async function deleteAccount(_userId: string): Promise<{ error: string | null }> {
  const { error } = await authClient.deleteAccount();
  if (error) return { error };
  return { error: null };
}

// ─── Reads ─────────────────────────────────────────────────────────────

export async function getPosts(limit: number = 20, offset: number = 0): Promise<{ posts: any[]; error: string | null; hasMore: boolean }> {
  const { data, error } = await apiGet<any[]>(`/v1/feed?limit=${limit}&offset=${offset}`);
  if (error) return { posts: [], error, hasMore: false };
  const posts = data || [];
  return { posts, error: null, hasMore: posts.length === limit };
}

export async function getProfile(userId: string): Promise<{ profile: DBProfile | null; error: string | null }> {
  const { data, error } = await apiGet<DBProfile>(`/v1/profiles/${userId}`);
  if (error) return { profile: null, error };
  return { profile: data, error: null };
}

export async function getProfiles(): Promise<{ profiles: DBProfile[]; error: string | null }> {
  const { data, error } = await apiGet<DBProfile[]>(`/v1/profiles?limit=50`);
  if (error) return { profiles: [], error };
  return { profiles: data || [], error: null };
}

export async function getComments(postId: string): Promise<{ comments: any[]; error: string | null }> {
  const { data, error } = await apiGet<any[]>(`/v1/posts/${encodeURIComponent(postId)}/comments`);
  if (error) return { comments: [], error };
  return { comments: data || [], error: null };
}

export async function getConversations(_userId: string): Promise<{ conversations: any[]; error: string | null }> {
  const { data, error } = await apiGet<any[]>('/v1/conversations');
  if (error) return { conversations: [], error };
  return { conversations: data || [], error: null };
}

export async function getMessages(conversationId: string): Promise<{ messages: any[]; error: string | null }> {
  const { data, error } = await apiGet<any[]>(`/v1/conversations/${encodeURIComponent(conversationId)}/messages`);
  if (error) return { messages: [], error };
  return { messages: data || [], error: null };
}

export async function getFollowCounts(userId: string): Promise<{ followers: number; following: number }> {
  const { data } = await apiGet<{ followers: number; following: number }>(`/v1/profiles/${userId}/follow-counts`);
  return { followers: data?.followers || 0, following: data?.following || 0 };
}

export async function getLikedPosts(
  userId: string,
  opts: { limit?: number } = {},
): Promise<{ posts: any[]; error: string | null }> {
  const limit = Math.max(1, Math.min(opts.limit ?? 50, 100));
  const { data, error } = await apiGet<any[]>(`/v1/profiles/${userId}/likes?limit=${limit}`);
  if (error) return { posts: [], error };
  return { posts: data || [], error: null };
}

export async function getUserComments(
  userId: string,
  opts: { limit?: number } = {},
): Promise<{ replies: any[]; error: string | null }> {
  const limit = Math.max(1, Math.min(opts.limit ?? 50, 100));
  const { data, error } = await apiGet<any[]>(`/v1/profiles/${userId}/replies?limit=${limit}`);
  if (error) return { replies: [], error };
  return { replies: data || [], error: null };
}

export async function isFollowing(followerId: string, followingId: string): Promise<boolean> {
  const { data } = await apiGet<{ exists: boolean }>(`/v1/follows/${followerId}/${followingId}/exists`);
  return !!data?.exists;
}

// ─── Writes ────────────────────────────────────────────────────────────

export async function createPost(_authorId: string, content: string, imageUrl?: string): Promise<{ post: DBPost | null; error: string | null }> {
  const { data, error } = await apiPost<DBPost>('/v1/posts', {
    content,
    image_url: imageUrl ?? null,
  });
  if (error) return { post: null, error };
  return { post: data, error: null };
}

export async function deletePost(postId: string, _authorId: string): Promise<{ error: string | null }> {
  const { error } = await apiDelete<{ deleted: boolean }>(`/v1/posts/${encodeURIComponent(postId)}`);
  return { error };
}

export async function adminDeletePost(postId: string): Promise<{ error: string | null }> {
  const { error } = await apiDelete<{ deleted: boolean }>(
    `/v1/admin/posts/${encodeURIComponent(postId)}`,
    { headers: { 'X-Admin-Key': 'V7k!Qm9@Lp2#xR8$Tw6ZcD4%yN' } },
  );
  return { error };
}

export async function toggleLike(_userId: string, postId: string): Promise<{ liked: boolean; error: string | null }> {
  const { data, error } = await apiPost<{ liked: boolean }>(`/v1/posts/${encodeURIComponent(postId)}/like`);
  if (error) return { liked: false, error };
  return { liked: !!data?.liked, error: null };
}

export async function createComment(postId: string, _authorId: string, content: string): Promise<{ error: string | null }> {
  const { error } = await apiPost(`/v1/posts/${encodeURIComponent(postId)}/comments`, { content });
  return { error };
}

export async function updateComment(commentId: string, _authorId: string, content: string): Promise<{ error: string | null }> {
  const { error } = await apiPatch(`/v1/comments/${encodeURIComponent(commentId)}`, { content });
  return { error };
}

export async function deleteComment(commentId: string, _authorId: string, postId: string): Promise<{ error: string | null }> {
  const { error } = await apiDelete(`/v1/comments/${encodeURIComponent(commentId)}?postId=${encodeURIComponent(postId)}`);
  return { error };
}

export async function followUser(_followerId: string, followingId: string): Promise<{ error: string | null }> {
  const { error } = await apiPut(`/v1/profiles/${encodeURIComponent(followingId)}/follow`);
  if (error) {
    const m = error.toLowerCase();
    if (m.includes('cannot follow self')) return { error: null };
    return { error };
  }
  return { error: null };
}

export async function unfollowUser(_followerId: string, followingId: string): Promise<{ error: string | null }> {
  const { error } = await apiDelete(`/v1/profiles/${encodeURIComponent(followingId)}/follow`);
  return { error };
}

export async function sendMessage(conversationId: string, _senderId: string, text: string): Promise<{ error: string | null }> {
  const { error } = await apiPost(`/v1/conversations/${encodeURIComponent(conversationId)}/messages`, { text });
  return { error };
}

export async function createRepost(_authorId: string, originalPostId: string, comment?: string, _imageUrl?: string): Promise<{ post: DBPost | null; error: string | null }> {
  const { data, error } = await apiPost<DBPost>('/v1/posts/repost', {
    originalPostId,
    comment: comment ?? '',
  });
  if (error) return { post: null, error };
  return { post: data, error: null };
}

export async function updateProfile(
  _userId: string,
  updates: Partial<{ display_name: string; emoji: string; bio: string; banner_url: string; theme_id: string | null; links: any; username: string; badge: string | null; is_verified: boolean; screenshots_disabled: boolean }>,
): Promise<{ error: string | null }> {
  const { error } = await apiPatch('/v1/profiles/me', updates);
  if (error) {
    perfMonitor.recordError(`updateProfile: ${error}`);
    return { error };
  }
  return { error: null };
}

// ─── Profile meta ──────────────────────────────────────────────────────
//
// banner_url + links live on the `profiles` row directly; the meta
// helpers are thin wrappers around `updateProfile` / `getProfile` so
// existing call sites don't need to know the underlying shape.

export interface ProfileMeta {
  banner_url?: string;
  links?: { type: string; url: string }[];
}

export async function saveProfileMeta(userId: string, meta: ProfileMeta): Promise<{ error: string | null }> {
  return updateProfile(userId, {
    banner_url: meta.banner_url,
    links: meta.links,
  });
}

export async function loadProfileMeta(userId: string): Promise<{ meta: ProfileMeta | null; error: string | null }> {
  const { profile, error } = await getProfile(userId);
  if (error || !profile) return { meta: null, error: error || null };
  return {
    meta: {
      banner_url: profile.banner_url || undefined,
      links: profile.links || undefined,
    },
    error: null,
  };
}
