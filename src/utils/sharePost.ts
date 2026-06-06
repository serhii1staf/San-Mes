// Share a post as an actual image + text (with a link) into other apps /
// social networks. The link is always appended so there is always something
// to share, and image-only posts still carry a caption + link.
//
// Strategy (iOS-first, this is an App Store app):
//   1. Resolve the post's first image URL (post or repost original).
//   2. Download it to a LOCAL file. Hermes/Expo has no expo-file-system here,
//      but expo-image-manipulator accepts a remote URI and returns a local
//      file:// uri — effectively downloading + caching it.
//   3. Share via react-native `Share.share({ message, url })`:
//        - On iOS the `url` (local image file) is attached as the photo and
//          `message` is the caption — both go into the share sheet together.
//   4. If there is no image, share the caption (content + link) as text.

import { Share, Platform } from 'react-native';
import type { Post } from '../types';

const SITE_BASE_URL = 'https://san-m-app.com';

/** Build the caption text from a post (content + link to the post). */
function buildCaption(post: Post): string {
  const parts: string[] = [];
  if (post.isRepost && post.originalPost) {
    const op = post.originalPost;
    if (op.content) parts.push(op.content);
  } else if (post.content) {
    parts.push(post.content);
  }
  // Always include a link back to the post so there is always something to
  // share (even for image-only posts) and the link opens our site.
  parts.push(`${SITE_BASE_URL}/post/${post.id}`);
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
 * Share a post as image + text. Always includes a link to the post, so there
 * is always something to share (never "nothing to share").
 */
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
            : { message: caption, url: localUri }
        );
        return;
      }
    }
    // No image (or download failed) → share text + link only.
    await Share.share({ message: caption });
  } catch {
    // User cancelled or share failed — stay silent (matches old behavior).
  }
}
