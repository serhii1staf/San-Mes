// Shared SSR helpers for the mini-app share routes:
//   - api/mini/[id].ts (legacy full-uuid links)
//   - api/m/[short].ts  (new 8-char prefix links)
//
// File is prefixed with "_lib" so Vercel's filesystem router skips it
// when discovering routes. Both routes import from here to avoid drift
// between the two landing pages.
//
// Phase 5 of the Cloudflare D1 migration: lookups go through the
// Worker's admin endpoints (X-Admin-Key header). The Worker is now
// the source of truth for mini-app data; Supabase is no longer
// queried.

const WORKER_BASE_URL = 'https://san-mes-api.odi44972.workers.dev';
// Hard-coded admin key — same string the in-app admin screen uses.
// This is server-side code on Vercel; the key never reaches the
// browser.
const ADMIN_KEY = process.env.ADMIN_KEY || 'V7k!Qm9@Lp2#xR8$Tw6ZcD4%yN';

export const APP_STORE_LINK = 'https://apps.apple.com/app/id6773943434';
export const APP_SCHEME = 'san-mes';
export const FALLBACK_OG_IMAGE = 'https://i.postimg.cc/k5jt7kL1/image.png';

export interface MiniAppPreview {
  id: string;
  name: string;
  emoji: string;
  description: string;
}

export function escapeHtml(s: string): string {
  return (s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function workerGet(path: string, admin = false): Promise<any> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (admin) headers['X-Admin-Key'] = ADMIN_KEY;
  try {
    const r = await fetch(`${WORKER_BASE_URL}${path}`, { headers });
    if (!r.ok) return null;
    const body = (await r.json()) as { data?: any; error?: string | null };
    return body?.data ?? null;
  } catch {
    return null;
  }
}

/** Fetch by exact id (legacy long-uuid path). */
export async function fetchMiniAppById(id: string): Promise<MiniAppPreview | null> {
  // Routes through the admin endpoint so SSR-side mini-app reads share
  // one auth path (X-Admin-Key) and one rate-limit budget. Returns the
  // narrow preview-only shape — the underlying third-party URL is
  // intentionally NOT exposed by this route.
  const data = await workerGet(`/v1/admin/mini-apps/${encodeURIComponent(id)}`, true);
  if (!data) return null;
  return { id: data.id, name: data.name, emoji: data.emoji, description: data.description };
}

/**
 * Fetch by id-prefix (new short link path). Routes through the
 * Worker's `by-short` admin endpoint, which does an indexed
 * `id LIKE 'prefix%'` lookup against the full `mini_apps` table —
 * not the top-100 newest list. The previous list+filter approach
 * silently dropped older mini-apps off the response once the table
 * grew past 100 rows, which was the root of the "Mini-app
 * unavailable" bug some users hit. The Worker still returns null
 * (200 + null body) when 0 or 2+ rows match the prefix, matching
 * the "ambiguous prefix" contract the SSR was already enforcing
 * client-side.
 */
export async function fetchMiniAppByPrefix(prefix: string): Promise<MiniAppPreview | null> {
  const clean = (prefix || '').toLowerCase().replace(/[^0-9a-f-]/g, '');
  if (clean.length === 0 || clean.length > 8) return null;
  const data = await workerGet(`/v1/admin/mini-apps/by-short/${encodeURIComponent(clean)}`, true);
  if (!data) return null;
  return { id: data.id, name: data.name, emoji: data.emoji, description: data.description };
}

export interface RenderOpts {
  title: string;
  description: string;
  ogImage: string;
  heading: string;
  emoji: string;
  subline?: string;
  deepLink: string;
  bodyHtml: string;
}

export function renderMiniAppPage(opts: RenderOpts): string {
  const { title, description, ogImage, heading, emoji, subline, deepLink, bodyHtml } = opts;
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:image" content="${escapeHtml(ogImage)}">
  <meta property="og:type" content="website">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${escapeHtml(ogImage)}">
  <meta name="theme-color" content="#E37857">
  <style>
    *{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent;}
    html{scrollbar-width:none;-ms-overflow-style:none;}
    html::-webkit-scrollbar,body::-webkit-scrollbar,*::-webkit-scrollbar{width:0;height:0;background:transparent;display:none;}
    html,body{width:100%;overflow-x:hidden;}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#EDE4FB;min-height:100vh;min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:18px;color:#16181c;}
    .card{position:relative;background:#fff;border-radius:26px;width:100%;max-width:430px;overflow:hidden;box-shadow:0 20px 60px rgba(80,60,120,0.22);}
    .cover{height:132px;background:linear-gradient(135deg,#F7A07E 0%,#E37857 55%,#D7625F 100%);position:relative;}
    .cover::after{content:'';position:absolute;inset:0;background:radial-gradient(circle at 78% 20%,rgba(255,255,255,0.18),transparent 45%);}
    .avatar-wrap{position:absolute;left:24px;top:84px;}
    .avatar{width:96px;height:96px;border-radius:30px;background:#FFEFE6;border:4px solid #fff;display:flex;align-items:center;justify-content:center;font-size:50px;box-shadow:0 8px 20px rgba(0,0,0,0.12);}
    .body{padding:60px 24px 24px;}
    .name{font-size:23px;font-weight:800;letter-spacing:-0.3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    .sub{font-size:15px;color:#8a8d93;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    .content{font-size:16px;line-height:1.55;margin-top:16px;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;color:#16181c;}
    .actions{margin-top:24px;display:flex;flex-direction:column;gap:10px;}
    .btn{display:flex;align-items:center;justify-content:center;gap:8px;color:#fff;text-decoration:none;padding:16px;border-radius:16px;font-weight:700;font-size:16px;border:none;width:100%;cursor:pointer;}
    .btn-primary{background:linear-gradient(135deg,#EC8C6E,#E37857);box-shadow:0 8px 22px rgba(227,120,87,0.4);}
    .btn-secondary{background:#16181c;}
    .foot{display:flex;align-items:center;justify-content:center;gap:6px;margin-top:20px;font-size:13px;color:#c2b8d8;font-weight:600;letter-spacing:0.3px;}
  </style>
</head>
<body>
  <div class="card">
    <div class="cover"></div>
    <div class="avatar-wrap"><div class="avatar">${emoji || '🧩'}</div></div>
    <div class="body">
      <div class="name">${escapeHtml(heading)}</div>
      ${subline ? `<div class="sub">${escapeHtml(subline)}</div>` : ''}
      ${bodyHtml}
      <div class="actions">
        <button class="btn btn-primary" id="openBtn">Открыть в San</button>
        <a class="btn btn-secondary" id="installBtn" href="${escapeHtml(APP_STORE_LINK)}">Установить San</a>
      </div>
      <div class="foot">🌸 San</div>
    </div>
  </div>
  <script>
    (function(){
      var deep=${JSON.stringify(deepLink)};
      var store=${JSON.stringify(APP_STORE_LINK)};
      function openApp(){
        var fired=false;
        function cancel(){ fired=true; }
        document.addEventListener('visibilitychange',function(){ if(document.hidden) cancel(); });
        window.addEventListener('pagehide',cancel);
        window.addEventListener('blur',cancel);
        window.location.href=deep;
        setTimeout(function(){ if(!fired && !document.hidden){ window.location.href=store; } },1500);
      }
      var b=document.getElementById('openBtn');
      if(b) b.addEventListener('click',openApp);
    })();
  </script>
</body>
</html>`;
}

export function renderNotFound(): string {
  return renderMiniAppPage({
    title: 'Мини-приложение — San',
    description: 'Это мини-приложение больше не доступно',
    ogImage: FALLBACK_OG_IMAGE,
    heading: 'Мини-приложение не найдено',
    emoji: '🧩',
    subline: 'San',
    deepLink: `${APP_SCHEME}://`,
    bodyHtml: '<div class="content">Возможно, оно было удалено автором. Открой San, чтобы посмотреть другие мини-приложения.</div>',
  });
}

export function renderResolved(app: MiniAppPreview, deepLink: string): string {
  const heading = app.name || 'Мини-приложение';
  const title = `${app.emoji || '🧩'} ${heading} — San`;
  const description = (app.description || `${heading} — мини-приложение в San`).slice(0, 160);
  const bodyHtml = app.description
    ? `<div class="content">${escapeHtml(app.description)}</div>`
    : '';
  return renderMiniAppPage({
    title,
    description,
    ogImage: FALLBACK_OG_IMAGE,
    heading,
    emoji: app.emoji || '🧩',
    subline: 'Мини-приложение в San',
    deepLink,
    bodyHtml,
  });
}
