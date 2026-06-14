import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  APP_SCHEME,
  FALLBACK_OG_IMAGE,
  fetchMiniAppById,
  renderMiniAppPage,
  renderNotFound,
  renderResolved,
} from '../_lib/miniAppRender';

// Vercel SSR for legacy mini-app share links: https://san-m-app.com/mini/<full-uuid>.
// Kept for backwards compatibility — every share generated before the
// short-link migration still resolves through this route. New shares go
// through /m/<8-char-prefix> via api/m/[short].ts.
//
// IMPORTANT: this page must NEVER expose `mini_apps.url` (the underlying
// third-party URL the WebView proxies to). The `select` inside
// fetchMiniAppById is narrow on purpose — id / name / emoji / description.

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const rawId = req.query?.id;
  const id = String(Array.isArray(rawId) ? rawId[0] : rawId || '').trim();

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.statusCode = 200;

  if (!id) {
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

  const app = await fetchMiniAppById(id);
  if (!app) {
    res.end(renderNotFound());
    return;
  }

  res.end(
    renderResolved(app, `${APP_SCHEME}://mini/${encodeURIComponent(app.id)}`),
  );
}
