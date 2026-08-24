/**
 * Turn stored message/comment content into a one-line human preview.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * Reported as: someone sends a photo or a GIF and the chat list shows something that "looks like a
 * link ID".
 *
 * That is literally what it was showing. The conversation row renders
 * `item.lastMessage || fallback`, and `lastMessage` is the RAW stored text — which for media is a
 * marker plus a URL (`::gif::https://media.giphy.com/…`). Nothing stripped it, so a GIF arrived as
 * a wall of URL and a photo as its R2 path.
 *
 * ── WHY A SHARED MODULE RATHER THAN A THIRD COPY ────────────────────────────
 *
 * The logic already existed TWICE before this file:
 *
 *   workers/api/src/push.ts   `cleanPushBody`     — so notification banners do not leak markers
 *   app/notifications.tsx     `stripMediaTokens`  — so the activity feed does not either
 *
 * Both were written because the same bug surfaced in their surface, and neither could help the
 * chat list because neither was importable from it (one runs on the Worker, one is a screen-local
 * function). Adding a third private copy would guarantee a fourth: the fullscreen/bubble preview
 * pair that just drifted apart is exactly what happens when a rule is duplicated instead of shared.
 *
 * So this is the client-side home for it. `stripMediaTokens` in app/notifications.tsx should be
 * replaced by a call to this — left alone here only because that screen has its own tests and the
 * two changes should not land together. The Worker copy has to stay separate: it runs in a
 * different runtime and cannot import from src/.
 *
 * ── THE MARKERS ─────────────────────────────────────────────────────────────
 *
 *   ::re::<base64(JSON)>::<body>    reply (current format)
 *   ::re:<b64>:<b64>[:<b64>]::<body>  reply (legacy)
 *   ::gif::<url>                    GIF-only message
 *   ::repost::<postId>::<comment>   repost
 *
 * IMPORTANT: always operate on the FULL text, never a pre-sliced prefix. Slicing first can cut the
 * closing `::` and leak the raw base64 blob — that exact bug is recorded in the Worker's copy.
 */

/** Labels the caller supplies, so this module does no i18n of its own. */
export interface PreviewLabels {
  photo: string;
  gif: string;
  link: string;
  reply: string;
}

/** Does this text consist only of a URL? Used to label bare links rather than printing them. */
function isBareUrl(s: string): boolean {
  return /^https?:\/\/\S+$/i.test(s);
}

/** Classify a bare URL so a photo does not get labelled as a generic link. */
function labelForUrl(url: string, labels: PreviewLabels): string {
  const u = url.toLowerCase();
  if (/\.gif(\?|$)/.test(u) || u.includes('giphy.com') || u.includes('tenor.com')) return labels.gif;
  if (/\.(jpg|jpeg|png|webp|heic|heif)(\?|$)/.test(u)) return labels.photo;
  return labels.link;
}

/**
 * Human-readable single line for a conversation row, a notification, or any other list that shows
 * "what was last said".
 *
 * Returns an empty string when there is nothing meaningful to show, so callers can fall back to
 * their own placeholder rather than being handed one.
 */
export function toPreviewText(raw: string | null | undefined, labels: PreviewLabels): string {
  if (!raw) return '';
  let s = raw;

  if (s.startsWith('::re::')) {
    const idx = s.indexOf('::', 6);
    const body = idx > 0 ? s.slice(idx + 2).trim() : '';
    // A reply with no typed body is a quote of something — usually a GIF. Without a body there is
    // nothing to preview, so name the act instead of showing the encoded quote.
    if (!body) return labels.reply;
    s = body;
  } else if (s.startsWith('::re:')) {
    const idx = s.indexOf('::', 5);
    const body = idx > 0 ? s.slice(idx + 2).trim() : '';
    if (!body) return labels.reply;
    s = body;
  } else if (s.startsWith('::repost::')) {
    const idx = s.indexOf('::', 10);
    s = idx > 0 ? s.slice(idx + 2).trim() : '';
  }

  // `::rp::<base64>::<body>` — a CHAT reply. Added when reply context started being persisted so it
  // survives the server (see src/utils/chatReplyMarker.ts). Handled explicitly rather than being left
  // to the unknown-marker safety net below, because that net returns an empty string: correct in that
  // it never leaks protocol, wrong in that a reply would show no preview at all. The body after the
  // marker is the actual message, which is exactly what a preview should show.
  if (s.startsWith('::rp::')) {
    const idx = s.indexOf('::', 6);
    const body = idx > 0 ? s.slice(idx + 2).trim() : '';
    // A reply carrying only media has no body of its own; the image branch below then labels it, and
    // failing that we name the act rather than showing nothing.
    if (!body) return labels.reply;
    s = body;
    // Fall through: the remaining text may itself begin with `::img::` or `::gif::`, because a send
    // writes the reply marker BEFORE the image marker.
  }

  if (s.startsWith('::img::')) {
    // Image marker: `::img::url1|url2::<caption>`. Prefer the caption when there is one, otherwise
    // label it — printing the urls is the "it looks like a link ID" bug this module exists to prevent.
    const idx = s.indexOf('::', 7);
    const body = idx > 0 ? s.slice(idx + 2).trim() : '';
    return body || labels.photo;
  }

  if (s.startsWith('::gif::')) return labels.gif;

  const trimmed = s.trim();
  if (isBareUrl(trimmed)) return labelForUrl(trimmed, labels);

  // Safety net: anything still leading with an unrecognised `::` marker must not leak. Better an
  // empty preview (the caller shows its own placeholder) than a row of raw protocol.
  if (trimmed.startsWith('::')) return '';

  return trimmed;
}

/**
 * The RAW human body of a stored message/comment, with every marker removed and nothing labelled.
 *
 * ── WHY THIS IS SEPARATE FROM `toPreviewText` ───────────────────────────────
 *
 * They look like the same function and are not. `toPreviewText` answers "what one line should this
 * row show", so for a photo with no caption it returns the word "Photo". This answers "what did the
 * human actually write", so for the same input it returns an empty string.
 *
 * That distinction matters to any caller that needs to inspect the body rather than print it. The
 * activity feed is one: it scans the residual text for a bare URL to decide whether to show a photo,
 * GIF or link chip beside the row. Handed a labelled preview it would find the word "Photo" and no
 * URL, and the chips would stop working. So the two contracts stay separate while the knowledge of
 * what the markers ARE lives here once.
 *
 * ── WHAT THIS FIXES WHERE IT IS NOW USED ────────────────────────────────────
 *
 * `app/notifications.tsx` had its own copy that knew only `::re::`, its legacy form, and `::gif::`.
 * Everything else fell through to its safety net — "leading `::` means return nothing" — which is
 * right about never leaking protocol and wrong about the result: a comment posted as a photo WITH a
 * caption showed a completely empty line, because the caption sits after the `::img::` marker the
 * copy had never heard of. Same for a chat-style `::rp::` reply and a `::repost::`.
 *
 * Returns an empty string when the content was markers only, or when a marker is present but
 * unterminated (a truncated store would otherwise leak a raw base64 blob — that exact bug is
 * recorded in the Worker's copy of this logic).
 */
export function stripMarkers(raw: string | null | undefined): string {
  if (!raw) return '';
  let s = raw;

  // Reply wrappers come first, because a send writes them BEFORE any media marker. Each carries a
  // base64 metadata blob terminated by `::`; the body is whatever follows.
  if (s.startsWith('::re::')) {
    const idx = s.indexOf('::', 6);
    s = idx > 0 ? s.slice(idx + 2) : '';
  } else if (s.startsWith('::rp::')) {
    const idx = s.indexOf('::', 6);
    s = idx > 0 ? s.slice(idx + 2) : '';
  } else if (s.startsWith('::re:')) {
    // Legacy single-colon reply: `::re:<b64>:<b64>[:<b64>]::<body>`
    const idx = s.indexOf('::', 5);
    s = idx > 0 ? s.slice(idx + 2) : '';
  } else if (s.startsWith('::repost::')) {
    const idx = s.indexOf('::', 10);
    s = idx > 0 ? s.slice(idx + 2) : '';
  }

  // Media markers, which may follow a reply wrapper — hence a second, non-exclusive check.
  if (s.startsWith('::img::')) {
    // `::img::url1|url2::<caption>` — the caption is the body. This is the line the activity feed
    // was dropping entirely.
    const idx = s.indexOf('::', 7);
    s = idx > 0 ? s.slice(idx + 2) : '';
  } else if (s.startsWith('::gif::')) {
    // A GIF message is nothing but its URL, so there is no body.
    return '';
  }

  const trimmed = s.trim();
  // Any residual unrecognised marker must not reach the UI. An empty string lets the caller show its
  // own placeholder, which is always better than a row of raw protocol.
  if (trimmed.startsWith('::')) return '';
  return trimmed;
}
