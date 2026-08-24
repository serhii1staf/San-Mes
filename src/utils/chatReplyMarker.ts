/**
 * Reply context, encoded into a message's stored text so it survives the server.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * Reported repeatedly: "I reply to a message and the other person just sees an ordinary message."
 *
 * The live path was never broken. The chat's realtime publish carries `replyToId` / `replyToText` /
 * `replyToImage`, and the receiver applies them (and even inverts "is the quote mine" correctly). What
 * was missing is PERSISTENCE: the only thing ever sent to the server was
 *
 *     { text: imageMarker + text }
 *
 * so the reply existed solely in the two devices' memory. Visible while both had the chat open; gone
 * the moment the peer opened it later and the transcript was rebuilt from the database. That is why it
 * seemed to work sometimes.
 *
 * ── WHY A TEXT MARKER RATHER THAN COLUMNS ───────────────────────────────────
 *
 * Columns would be cleaner and are the right long-term answer. They need a D1 migration, and the
 * Cloudflare token available here is rejected for D1 (code 7403) — two migrations are already queued
 * unapplied for that reason. A marker inside the existing text column needs no schema change and no
 * Worker change, and the codebase already does exactly this for images (`::img::url1|url2::`) and for
 * comment replies (`::re::`), so it is the established convention rather than a new invention.
 *
 * ── THE FORMAT ──────────────────────────────────────────────────────────────
 *
 *     ::rp::<base64 of JSON>::<the rest of the message>
 *
 * and a send writes it BEFORE the image marker, so a photo reply reads
 *
 *     ::rp::<b64>::::img::<url>::<text>
 *
 * The payload is base64 so a quoted message containing `::` — or a newline, or an emoji — cannot break
 * the framing. That is a real risk with a delimiter-only scheme: quoted text is arbitrary user input.
 *
 * ── WHAT IS NOT STORED, ON PURPOSE ──────────────────────────────────────────
 *
 * `replyToIsOwn` is NOT transmitted. "Is the quoted message mine" is relative to whoever is looking, so
 * a stored `true` is wrong on exactly one of the two devices. The quoted AUTHOR's id is stored instead
 * and ownership is derived at parse time. Same reasoning the chat already applies to message ownership
 * itself, which is compared at render time rather than baked in at receive time.
 *
 * Backwards compatible in both directions: a message without the marker decodes to `null` and is left
 * exactly as it was, and an older client that does not know `::rp::` shows the marker as leading text
 * rather than crashing — which is why `decodeReplyMarker` is also wired into the preview cleaner path,
 * so the marker can never reach a chat-list row.
 */

import type { ChatMessage } from '../types';

const PREFIX = '::rp::';

interface StoredReply {
  /** Quoted message id, so a tap can still jump to it. */
  i?: string;
  /** Quoted text (already trimmed of markers by the sender). */
  t?: string;
  /** Quoted image url, for a quote of a photo/GIF. */
  m?: string;
  /** Quoted message's AUTHOR id — ownership is derived from this, never transmitted as a boolean. */
  s?: string;
  /** Decorative per-chat pixel icon stamped on reply blocks. */
  p?: string;
}

/** Minimal base64 for arbitrary UTF-8, without pulling in a dependency. */
function toBase64(input: string): string {
  try {
    // `unescape(encodeURIComponent(...))` widens UTF-8 to latin1 so btoa accepts it. Hermes provides
    // btoa/atob; the try/catch covers any runtime where it does not.
    return global.btoa(unescape(encodeURIComponent(input)));
  } catch {
    return '';
  }
}

function fromBase64(input: string): string {
  try {
    return decodeURIComponent(escape(global.atob(input)));
  } catch {
    return '';
  }
}

/**
 * Build the marker for an outgoing message. Returns '' when there is nothing to encode, so callers can
 * prepend unconditionally.
 */
export function encodeReplyMarker(reply: {
  id?: string;
  text?: string;
  image?: string;
  senderId?: string;
  pixelIconId?: string;
} | null | undefined): string {
  if (!reply || (!reply.id && !reply.text && !reply.image)) return '';
  const stored: StoredReply = {};
  if (reply.id) stored.i = reply.id;
  // Capped: a quote is a one-line preview, and the whole message still has to fit the server's text
  // limit alongside its own body.
  if (reply.text) stored.t = reply.text.slice(0, 300);
  if (reply.image) stored.m = reply.image;
  if (reply.senderId) stored.s = reply.senderId;
  if (reply.pixelIconId) stored.p = reply.pixelIconId;
  const b64 = toBase64(JSON.stringify(stored));
  if (!b64) return '';
  return `${PREFIX}${b64}::`;
}

/**
 * Strip and decode the marker. Returns `null` when the text does not carry one, so the caller can leave
 * the message untouched.
 *
 * `currentUserId` is used only to derive `replyToIsOwn` — see the note above on why that is computed
 * rather than stored.
 */
export function decodeReplyMarker(
  text: string | undefined | null,
  currentUserId: string | undefined,
): { fields: Partial<ChatMessage>; rest: string } | null {
  if (!text || !text.startsWith(PREFIX)) return null;
  const end = text.indexOf('::', PREFIX.length);
  if (end === -1) return null;
  const json = fromBase64(text.slice(PREFIX.length, end));
  if (!json) return null;
  let stored: StoredReply;
  try {
    stored = JSON.parse(json);
  } catch {
    return null;
  }
  if (!stored || typeof stored !== 'object') return null;
  return {
    fields: {
      replyToId: stored.i,
      replyToText: stored.t,
      replyToImage: stored.m,
      // Derived, not transmitted. Undefined when the quoted author is unknown, which renders the
      // neutral quote style rather than guessing a side.
      replyToIsOwn: stored.s && currentUserId ? stored.s === currentUserId : undefined,
      replyPixelIconId: stored.p,
    } as Partial<ChatMessage>,
    rest: text.slice(end + 2),
  };
}

/** True when the text carries a reply marker. Cheap check for preview/cleaning paths. */
export function hasReplyMarker(text: string | undefined | null): boolean {
  return !!text && text.startsWith(PREFIX);
}
