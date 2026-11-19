import type { LinkPreviewData } from '../services/linkPreview';

/**
 * The thumbnail URL and width a link-preview card shows. Shared by the card (LinkPreview.tsx) and
 * the chat-list warm-up (messagesPrefetch.ts), because the width is part of the image cache key:
 * the warm-up used the photo width instead, so every preview image it fetched was a copy no card
 * ever displayed.
 */

/**
 * YouTube's `hqdefault` (480x360) swapped for `mqdefault` (320x180), which is already larger than
 * either card layout draws it. Also applied to previews cached before `api/unfurl.ts` made the same
 * switch.
 */
export function linkPreviewThumbUrl(uri: string | undefined | null): string | undefined {
  if (!uri) return undefined;
  if (uri.indexOf('i.ytimg.com/vi/') === -1) return uri;
  if (uri.indexOf('/hqdefault.') === -1) return uri;
  return uri.replace('/hqdefault.', '/mqdefault.');
}

/** The proxy width the card requests: 200 for the 16:9 video layout, 60 for the thin link row. */
export function linkPreviewThumbWidth(d: LinkPreviewData | null | undefined): number {
  if (!d) return 60;
  const video = ((d.provider === 'youtube' || d.provider === 'vimeo') && !!d.videoId) || d.type === 'video';
  return video ? 200 : 60;
}
