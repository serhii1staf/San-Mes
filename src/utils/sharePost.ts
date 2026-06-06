// Share a post as an actual image + text into other apps / social networks,
// instead of just sharing a link back to our domain.
//
// Strategy (iOS-first, this is an App Store app):
//   1. Resolve the post's first image URL (post or repost original).
//   2. Download it to a LOCAL file. Hermes/Expo has no expo-file-system here,
//      but expo-image-manipulator accepts a remote URI and returns a local
//      file:// uri — effectively downloading + caching it.
//   3. Share via react-native `Share.share({ message, url })`:
//        - On iOS the `url` (local image file) is attached as the photo and
//          `message` is the caption — both go into the share sheet together,
//          so the image lands in Instagram/Telegram/WhatsApp/etc. with text.
//   4. If there is no image, fall back to sharing just the text.
//
// We intentionally do NOT share the Supabase/site link anymore.

import { Share, Platform } from 'react-native';
import { showToast } from '../store/toastStore';
import type { Post } from '../types';

/** Build the caption text from a post (author + content), no URL. */
function buildCaption(post: Post): string {
  const parts: string[] = [];
  if (post.isRepost && post.originalPost) {
    const op = post.originalPost;
    if (op.content) parts.push(op.content);
  } else if (post.content) {
    parts.push(post.content);
  }
  return parts.join('\n').trim();
}

/** Resolve the first displayable image URL for a post (or its repost original). */
function firstImageUrl(post: Post): string | null {
  if (post.isRepost && post.originalPost) {
    return post.originalPost.imageUrls?.[0] || post.originalPost.imageUrl || null;
  }
  return post.imageUrls?.[0] || post.imageUrl || null;
}

/**
 * Download a (possibly remote) image URI to a local file and return its
 * file:// uri. Uses expo-image-manipulator which fetches remote URIs.
 * Returns null on failure.
 */
async function toLocalImageFile(uri: string): Promise<string | null> {
  try {
    const { manipulateAsync, SaveFormat } = await import('expo-image-manipulator');
    // No-op transform: just re-encode to a local JPEG file.
    const result = await manipulateAsync(uri, [], { compress: 0.9, format: SaveFormat.JPEG });
    return result.uri || null;
  } catch {
    return null;
  }
}

/**
 * Share a single image (by URL) as an actual photo file, with optional caption.
 * Downloads the remote image to a local file then shares it. Falls back to
 * sharing the URL as text if the download fails.
 */
export async function shareImageUrl(imageUrl: string | null | undefined, caption?: string): Promise<void> {
  if (!imageUrl) return;
  try {
    const localUri = await toLocalImageFile(imageUrl);
    if (localUri) {
      await Share.share(
        Platform.OS === 'ios'
          ? { url: localUri, message: caption || undefined }
          : { message: caption || '', url: localUri }
      );
      return;
    }
    await Share.share({ message: caption ? `${caption}\n${imageUrl}` : imageUrl });
  } catch {
    // cancelled / failed — silent
  }
}
export async function sharePost(post: Post | null | undefined): Promise<void> {
  if (!post) return;
  const caption = buildCaption(post);
  const imageUrl = firstImageUrl(post);

  try {
    if (imageUrl) {
      const localUri = await toLocalImageFile(imageUrl);
      if (localUri) {
        // iOS: url = image file, message = caption → both shared together.
        // Android: many targets accept the file url; message carries the text.
        await Share.share(
          Platform.OS === 'ios'
            ? { url: localUri, message: caption || undefined }
            : { message: caption ? `${caption}` : '', url: localUri }
        );
        return;
      }
    }
    // No image (or download failed) → share text only.
    if (caption) {
      await Share.share({ message: caption });
    } else {
      showToast('Нечего отправить', 'x');
    }
  } catch {
    // User cancelled or share failed — stay silent (matches old behavior).
  }
}
