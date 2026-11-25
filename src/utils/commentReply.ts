/**
 * Reply quoting for comments, without a schema change. A reply comment is stored as:
 *
 *   ::re::<base64(JSON{u, sn, gif})>::<actual body>
 *
 * The quote metadata is packed into a SINGLE base64 blob. Base64's alphabet never contains ':', so
 * the first "::" after the blob is unambiguously the body terminator. That fixed an earlier bug where
 * an empty segment produced a stray "::" that truncated the body (showing a raw base64 string).
 *
 * Moved here from `app/comments/[id].tsx` (Nov 2026) because the «Ответы» tab on a profile shows the
 * same comments and needs the same reading of them. It used to strip the markers with
 * `stripMarkers`, which returns nothing for a GIF, and then fell back to the stored content: a GIF
 * reply showed up as `::re::…::::gif::https://…/v1/stickers/…`.
 */

export const REPLY_PREFIX = '::re::';

export function b64encode(s: string): string {
  try { return global.btoa ? global.btoa(unescape(encodeURIComponent(s))) : Buffer.from(s, 'utf8').toString('base64'); }
  catch { return ''; }
}

export function b64decode(s: string): string {
  try { return global.atob ? decodeURIComponent(escape(global.atob(s))) : Buffer.from(s, 'base64').toString('utf8'); }
  catch { return ''; }
}

export function encodeReply(username: string, snippet: string, body: string, gifUrl?: string): string {
  const meta = JSON.stringify({ u: username || '', sn: (snippet || '').slice(0, 140), gif: gifUrl || '' });
  return `${REPLY_PREFIX}${b64encode(meta)}::${body}`;
}

export interface ParsedReply {
  replyUser?: string;
  replyText?: string;
  replyGif?: string;
  body: string;
}

export function parseReply(content: string): ParsedReply {
  // New format: ::re::<base64(json)>::<body>
  if (content.startsWith(REPLY_PREFIX)) {
    const rest = content.slice(REPLY_PREFIX.length);
    const endIdx = rest.indexOf('::');
    if (endIdx === -1) return { body: content };
    const blob = rest.slice(0, endIdx);
    const body = rest.slice(endIdx + 2);
    try {
      const meta = JSON.parse(b64decode(blob));
      return {
        replyUser: meta.u || undefined,
        replyText: meta.sn || undefined,
        replyGif: meta.gif || undefined,
        body,
      };
    } catch {
      return { body };
    }
  }
  // Legacy A: ::re:<b64(u)>:<b64(sn)>[:<b64(gif)>]::<body>
  if (content.startsWith('::re:')) {
    const rest = content.slice('::re:'.length);
    const endIdx = rest.indexOf('::');
    if (endIdx !== -1) {
      const head = rest.slice(0, endIdx);
      const body = rest.slice(endIdx + 2);
      const parts = head.split(':');
      const u = b64decode(parts[0] || '');
      const sn = b64decode(parts[1] || '');
      const gif = parts.length > 2 ? b64decode(parts[2] || '') : '';
      if (u || sn || gif) return { replyUser: u || undefined, replyText: sn || undefined, replyGif: gif || undefined, body };
    }
  }
  return { body: content };
}
