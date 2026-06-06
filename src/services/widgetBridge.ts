import { Platform } from 'react-native';

/**
 * widgetBridge — pushes the latest feed posts into the iOS App Group so the
 * native home-screen widget (targets/widget) can render them.
 *
 * Safe no-op when:
 *  - running on Android,
 *  - the @bacons/apple-targets native module isn't in the current build
 *    (e.g. an OTA JS update that lands before the matching native build).
 */

const APP_GROUP = 'group.com.sanmes.app';
const FEED_KEY = 'widget_feed_posts';
const MAX_WIDGET_POSTS = 4;

export interface WidgetPost {
  id: string;
  author: string;
  emoji: string;
  content: string;
}

let ExtensionStorage: any = null;
try {
  // Lazy require so a missing native module degrades gracefully.
  ExtensionStorage = require('@bacons/apple-targets').ExtensionStorage;
} catch {
  ExtensionStorage = null;
}

/**
 * Write the top feed posts to the shared App Group and reload the widget.
 * Accepts the app's view-model posts and maps them to the compact widget shape.
 */
export function updateFeedWidget(posts: Array<{
  id: string;
  authorName?: string;
  authorEmoji?: string;
  content?: string;
}>): void {
  if (Platform.OS !== 'ios' || !ExtensionStorage) return;

  try {
    const mapped: WidgetPost[] = posts
      .slice(0, MAX_WIDGET_POSTS)
      .map((p) => ({
        id: String(p.id),
        author: (p.authorName || 'User').slice(0, 40),
        emoji: p.authorEmoji || '😊',
        // Strip media markers and trim so the widget stays light.
        content: stripMarkers(p.content || '').slice(0, 120),
      }));

    const storage = new ExtensionStorage(APP_GROUP);
    // Store as a JSON string; the Swift side parses it from UserDefaults.
    storage.set(FEED_KEY, JSON.stringify(mapped));
    ExtensionStorage.reloadWidget();
  } catch {
    // Never let widget updates affect the app flow.
  }
}

function stripMarkers(text: string): string {
  // Remove the in-app image/repost markers so the widget shows clean text.
  return text
    .replace(/::img::[^:]*::/g, '')
    .replace(/::spoiler::/g, '')
    .replace(/::repost::[^\s]*/g, '')
    .trim();
}
