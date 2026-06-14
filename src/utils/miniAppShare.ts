import type { MiniApp } from '../store/miniAppsStore';

// Single source of truth for mini-app share URL generation. Every caller
// (mini-app screen, settings list, AI chat manage list, future surfaces)
// MUST go through this so we can swap to a real slug column later without
// hunting through the codebase.
//
// Format: https://san-m-app.com/m/<8-char-prefix> where the prefix is the
// first 8 chars of the row's UUID `id`. The server route at api/m/[short]
// resolves the prefix back to a row via `id LIKE '<8>%' LIMIT 2` — if
// exactly one row matches we redirect, if 0 or 2+ we render a 404.
//
// 8 chars on a v4 UUID gives ~4.3B namespace which is plenty for our
// volume; collisions are rejected at share time by the SSR endpoint
// rather than by us refusing to generate a link.

const SHARE_HOST = 'https://san-m-app.com';
const SHORT_LEN = 8;

export function miniAppShortId(fullId: string): string {
  // Plain prefix — UUID v4 layout is "xxxxxxxx-xxxx-..." so the first 8
  // chars never include a dash. Resolution is `id LIKE '<8>%'` server-side,
  // so the prefix and the canonical id stay in sync without normalisation.
  return (fullId || '').slice(0, SHORT_LEN);
}

export function buildMiniAppShareUrl(app: Pick<MiniApp, 'id'>): string {
  return `${SHARE_HOST}/m/${miniAppShortId(app.id)}`;
}

// Match the new short format AND the legacy long format. Used by the
// generic LinkPreview to decide when to swap in MiniAppPreviewCard.
export const MINI_APP_SHARE_REGEX = /^https?:\/\/san-m-app\.com\/(?:m|mini)\/([A-Za-z0-9-]+)/i;

export function extractMiniAppShareId(url: string): string | null {
  if (!url) return null;
  const m = url.match(MINI_APP_SHARE_REGEX);
  return m ? m[1] : null;
}

// UUIDs are a native UUID column — Postgres rejects LIKE on UUID without an
// explicit cast. Convert a 1-8 char hex prefix into the equivalent UUID
// range so callers can do `id >= lo AND id <= hi` against the indexed
// primary key. Returns null for empty / invalid input.
const UUID_TEMPLATE = '00000000-0000-0000-0000-000000000000';
const UUID_TEMPLATE_F = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

export function miniAppPrefixRange(prefix: string): { lo: string; hi: string } | null {
  const clean = (prefix || '').toLowerCase().replace(/[^0-9a-f]/g, '');
  if (clean.length === 0 || clean.length > 8) return null;
  const lo = clean.padEnd(8, '0') + UUID_TEMPLATE.slice(8);
  const hi = clean.padEnd(8, 'f') + UUID_TEMPLATE_F.slice(8);
  return { lo, hi };
}
