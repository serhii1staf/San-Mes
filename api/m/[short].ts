import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  APP_SCHEME,
  FALLBACK_OG_IMAGE,
  fetchMiniAppByPrefix,
  renderMiniAppPage,
  renderNotFound,
  renderResolved,
} from '../_lib/miniAppRender';

// Short-link SSR for mini-apps: https://san-m-app.com/m/<8-char-prefix>.
// Resolves the prefix back to an exact row by `id LIKE '<prefix>%' LIMIT 2`.
// If exactly one row matches we render the standard preview page with a
// deep link of `san-mes://m/<prefix>` (the in-app handler at app/m/[short]
// then runs the same prefix lookup and pushes /mini-app). If 0 or 2+ rows
// match we render the same "not found" page that the legacy route uses,
// so an ambiguous prefix never silently lands the user on the wrong app.
//
// The legacy /mini/<full-uuid> route stays live — see api/mini/[id].ts.
// Existing shares remain valid forever.

const SHORT_LEN = 8;
// Whitelist for the prefix to keep this from being a fishing endpoint:
// only hex-and-dash characters, capped at 8 chars (UUID prefix).
const VALID_SHORT = /^[A-Za-z0-9-]{1,8}$/;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const rawShort = req.query?.short;
  const short = String(Array.isArray(rawShort) ? rawShort[0] : rawShort || '').trim();

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.statusCode = 200;

  if (!short || !VALID_SHORT.test(short)) {
    res.end(
      renderMiniAppPage({
        title: 'Мини-приложение — San',
        description: 'Открой это мини-приложение в San',
        ogImage: FALLBACK_OG_IMAGE,
        heading: 'Мини-приложение',
        emoji: '🧩',
        subline: 'San',
        deepLink: `${APP_SCHEME}://`,
        bodyHtml: '',
      }),
    );
    return;
  }

  // Truncate defensively — a malformed link with extra chars still resolves
  // by its first 8 characters (PostgREST `like` with a fixed-length prefix
  // is the cheapest possible lookup against an indexed UUID column).
  const prefix = short.slice(0, SHORT_LEN);
  const app = await fetchMiniAppByPrefix(prefix);
  if (!app) {
    res.end(renderNotFound());
    return;
  }

  res.end(
    renderResolved(app, `${APP_SCHEME}://m/${encodeURIComponent(prefix)}`),
  );
}
