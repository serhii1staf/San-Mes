// Pre-warm expo-image's disk cache for the most recent message media of the
// user's most-active conversations.
//
// Why this exists
// ---------------
// When a chat opens, every message bubble in the FlatList window mounts at
// the same RAF tick — and each one fires a CachedImage / LinkPreview thumb
// fetch. With a cold weserv cache that's 7+ images racing at once, each
// taking 0.4–1.5 s for the first round-trip (Cloudflare → origin → resize →
// back). Once on disk the second visit is a near-instant <100 ms read.
//
// We can hide that latency by warming the disk cache BEFORE the chat opens.
// The user is almost always parked on (tabs)/messages for a second or two
// before tapping a row, so we use that idle time to prefetch the thumbs of
// the last few messages in each likely-next chat.
//
// Cost
// ----
// 12 chats × 3 messages × ~2 URIs each = ~72 cheap MMKV reads + a single
// `Image.prefetch(uris)` batch (which expo-image dedupes internally and
// runs on its own scheduler). The MMKV reads happen on the JS thread but
// are chunked across microtasks via `await Promise.resolve()` so we never
// block the JS thread for more than one chat's loop body at a time.

import { kvGetJSONSync } from './kvStore';
import { prefetchImages } from '../components/ui/CachedImage';
import { extractFirstUrl, getCachedPreviewSync } from './linkPreview';
import type { ChatMessage } from '../types';

interface PrefetchOpts {
  /** Conversation IDs ordered most-recently-active first. Capped at 12. */
  conversationIds: string[];
  /** Hard cap on total image URIs queued to expo-image. Defaults to 24. */
  budgetUris?: number;
}

const MAX_CONVERSATIONS = 12;
const MESSAGES_PER_CHAT = 3;
const DEFAULT_BUDGET = 24;

/**
 * Warm expo-image's disk cache for the recent media of the listed
 * conversations. Fire-and-forget; safe to call multiple times (expo-image
 * dedupes by URL internally).
 *
 * For each conversation:
 *   1. Read the cached `chat_messages:<id>` array (synchronous MMKV read).
 *   2. Walk the last `MESSAGES_PER_CHAT` messages and harvest:
 *        - every URL in `imageUrls`
 *        - the first http(s) URL extracted from `text`, ONLY if a link
 *          preview is already cached (so we surface the OG image without
 *          firing speculative /api/unfurl requests).
 *   3. Yield to the JS thread between conversations via `await Promise.resolve()`.
 *
 * After all chats are scanned, the deduped URI list is handed to
 * `prefetchImages`, which routes each URL through the weserv proxy at a
 * thumb-friendly width and queues it into expo-image's internal scheduler.
 */
export async function prefetchRecentChatMedia(opts: PrefetchOpts): Promise<void> {
  const { conversationIds, budgetUris = DEFAULT_BUDGET } = opts;
  if (!conversationIds || conversationIds.length === 0) return;

  const ids = conversationIds.slice(0, MAX_CONVERSATIONS);
  const seen = new Set<string>();
  const collected: string[] = [];

  for (const id of ids) {
    if (collected.length >= budgetUris) break;
    // Yield to the JS thread between conversations so this never piles up
    // into a long task even if MMKV warm-up is cold and the JSON.parse is
    // sizeable.
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve();

    let messages: ChatMessage[];
    try {
      messages = kvGetJSONSync<ChatMessage[]>(`chat_messages:${id}`, []);
    } catch {
      continue;
    }
    if (!messages || messages.length === 0) continue;

    // Last N messages — these are the ones the user sees first when the
    // FlatList opens at the bottom of the chat.
    const slice = messages.slice(-MESSAGES_PER_CHAT);
    for (const m of slice) {
      // Direct image attachments.
      if (m.imageUrls && m.imageUrls.length > 0) {
        for (const u of m.imageUrls) {
          if (!u || seen.has(u)) continue;
          seen.add(u);
          collected.push(u);
          if (collected.length >= budgetUris) break;
        }
      }
      if (collected.length >= budgetUris) break;

      // Link-preview image — but only if the preview is ALREADY cached.
      // We don't want to trigger /api/unfurl for every URL the user has
      // ever pasted; that would defeat the cost goal of this prefetch.
      const url = extractFirstUrl(m.text);
      if (url) {
        const cached = getCachedPreviewSync(url);
        const img = cached && cached.image;
        if (img && !seen.has(img)) {
          seen.add(img);
          collected.push(img);
        }
      }
      if (collected.length >= budgetUris) break;
    }
  }

  if (collected.length === 0) return;
  // Single batched call into expo-image's prefetcher. The function already
  // routes through the weserv proxy and is fire-and-forget.
  try {
    prefetchImages(collected);
  } catch {
    // ignore — prefetch is best-effort
  }
}
