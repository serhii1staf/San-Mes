// Reading the `::img::` marker out of a stored chat message.
//
// Attached images are not a column on `messages`. They ride inside the stored `text` as
//
//     ::rp::<base64>::::img::<url>|<url>::<caption>
//
// with the reply wrapper first when the message is a reply, then the image list, then the caption.
// The full decode into `imageUrls` lives in `app/chat/[id].tsx` (`parseMessage`) and is duplicated in
// `src/components/realtime/RealtimeAccountBridge.tsx`, with preview-only strippers in
// `src/utils/previewText.ts` and `src/services/widgetBridge.ts` — five hand-rolled readers of one
// format.
//
// This file deliberately does NOT try to unify those. It adds the one narrow question that the image
// dimensions on the wire (migration 0006) need answering, in one place, so that answering it does not
// become a sixth copy:
//
//     which url do `img_w` / `img_h` describe?
//
// Answer: the first one. `fitChatImageBox` is only ever applied to a single-image bubble
// (`imageUrls.length === 1`); a multi-image bubble renders a fixed grid. So one pair of dimensions
// per message is enough, and it belongs to `imageUrls[0]`.

/**
 * The first image url inside a stored message body, or `null`.
 *
 * Finds the marker by SEARCHING rather than by testing the start of the string, which is what makes
 * it independent of the reply wrapper. `parseMessage` can afford `startsWith('::img::')` because it
 * has already stripped `::rp::…::` by the time it looks; callers that only want the url (the history
 * mapper, seeding the dimension cache) have not, and would silently find nothing on every reply that
 * carried a photo.
 */
export function firstImageUrlFromStoredText(text: string | undefined | null): string | null {
  if (!text) return null;
  const at = text.indexOf('::img::');
  if (at < 0) return null;
  const from = at + 7;
  // The marker is terminated by the next `::`. A body with an opening marker and no terminator is
  // malformed; treat it as "no images" rather than swallowing the rest of the message as a url,
  // which is the same call `parseMessage` makes for the same case.
  const end = text.indexOf('::', from);
  if (end < 0) return null;
  const first = text.slice(from, end).split('|')[0];
  return first || null;
}
