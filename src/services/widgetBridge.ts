import { Platform } from 'react-native';

/**
 * widgetBridge — pushes the latest feed posts into the iOS App Group so the
 * native home-screen widget (targets/widget) can render them.
 *
 * Safe no-op when:
 *  - running on Android,
 *  - the @bacons/apple-targets native module isn't in the current build.
 */

const APP_GROUP = 'group.com.sanmes.app';
const FEED_KEY = 'widget_feed_posts';
const DEFAULT_MAX_WIDGET_POSTS = 4;

export interface WidgetPost {
  id: string;
  author: string;
  emoji: string;
  content: string;
  verified: boolean;
  image: string; // first image URL ('' if none)
}

let ExtensionStorage: any = null;
try {
  ExtensionStorage = require('@bacons/apple-targets').ExtensionStorage;
} catch {
  ExtensionStorage = null;
}

/** True when the native widget module is present in the current build. */
export function isWidgetAvailable(): boolean {
  return Platform.OS === 'ios' && !!ExtensionStorage;
}

/**
 * Write the top feed posts to the shared App Group and reload the widget.
 */
export function updateFeedWidget(
  posts: Array<{
    id: string;
    authorName?: string;
    authorEmoji?: string;
    authorVerified?: boolean;
    content?: string;
    imageUrl?: string;
    imageUrls?: string[];
  }>,
  maxPosts: number = DEFAULT_MAX_WIDGET_POSTS
): void {
  if (Platform.OS !== 'ios' || !ExtensionStorage) return;

  try {
    const limit = Math.max(1, Math.min(4, maxPosts));
    const mapped: WidgetPost[] = posts
      .slice(0, limit)
      .map((p) => {
        const firstImage = p.imageUrl || (p.imageUrls && p.imageUrls[0]) || extractMarkerImage(p.content) || '';
        return {
          id: String(p.id),
          author: (p.authorName || 'User').slice(0, 40),
          emoji: p.authorEmoji || '😊',
          content: stripMarkers(p.content || '').slice(0, 120),
          verified: !!p.authorVerified,
          image: typeof firstImage === 'string' && firstImage.startsWith('http') ? firstImage : '',
        };
      });

    const storage = new ExtensionStorage(APP_GROUP);
    // Store as a JSON string; the Swift side parses it from UserDefaults.
    storage.set(FEED_KEY, JSON.stringify(mapped));
    ExtensionStorage.reloadWidget();
  } catch {
    // Never let widget updates affect the app flow.
  }
}

/** Force the home-screen widget to reload its timeline from the latest cached data. */
export function reloadWidgetNow(): void {
  if (Platform.OS !== 'ios' || !ExtensionStorage) return;
  try {
    ExtensionStorage.reloadWidget();
  } catch {
    // ignore
  }
}

// Pull the first image URL out of the in-app "::img::url1|url2::" marker.
function extractMarkerImage(text?: string): string {
  if (!text) return '';
  const m = text.match(/::img::([^:]+)::/);
  if (m && m[1]) {
    const first = m[1].split('|')[0];
    return first || '';
  }
  return '';
}

function stripMarkers(text: string): string {
  return text
    .replace(/::img::[^:]*::/g, '')
    .replace(/::spoiler::/g, '')
    .replace(/::repost::[^\s]*/g, '')
    .trim();
}
