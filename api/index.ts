import type { IncomingMessage, ServerResponse } from 'http';

// Phase 5 of the Cloudflare D1 migration: SSR fetches go through the
// Worker's admin endpoints (gated by the X-Admin-Key header). Supabase
// is no longer queried from the server.
const WORKER_BASE_URL = 'https://san-mes-api.odi44972.workers.dev';
// Admin key is read from the Vercel env ONLY — there is no baked-in
// fallback. If it's missing, every admin-gated lookup fails closed
// (see workerGet) rather than leaking a committed credential. The key
// unlocks Worker endpoints that return arbitrary users' data, so a
// cleartext fallback would be a critical exposure.
const ADMIN_KEY = process.env.ADMIN_KEY;

// App Store link (app not published yet) + custom scheme deep link for the
// installed app. The page tries the scheme first, then falls back to the store.
const APP_STORE_LINK = 'https://apps.apple.com/app/id6773943434';
const APP_SCHEME = 'san-mes';
const FALLBACK_OG_IMAGE = 'https://san-m-app.com/og-icon.png';
const IMAGE_SEP = '|';
const SPOILER_PREFIX = '::spoiler::';
const REPOST_PREFIX = '::repost::';

function escapeHtml(s: string): string {
  return (s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function firstImage(imageUrl?: string | null): string | null {
  if (!imageUrl) return null;
  const clean = imageUrl.startsWith(SPOILER_PREFIX) ? imageUrl.slice(SPOILER_PREFIX.length) : imageUrl;
  const parts = clean.split(IMAGE_SEP).filter(Boolean);
  return parts[0] || null;
}

async function workerGet(path: string): Promise<any> {
  // Fail closed: without a configured ADMIN_KEY we must NOT issue the
  // admin-gated request at all. Returning null surfaces as the generic
  // SSR fallback page instead of sending an empty/garbage key.
  if (!ADMIN_KEY) return null;
  try {
    const r = await fetch(`${WORKER_BASE_URL}${path}`, {
      headers: { Accept: 'application/json', 'X-Admin-Key': ADMIN_KEY },
    });
    if (!r.ok) return null;
    const body = (await r.json()) as { data?: any; error?: string | null };
    return body?.data ?? null;
  } catch {
    return null;
  }
}

async function fetchPost(id: string) {
  // Worker returns the same shape Supabase did (`profiles:author_id`
  // embed) so the renderer below doesn't change.
  return await workerGet(`/v1/admin/posts/${encodeURIComponent(id)}`);
}

async function fetchProfile(id: string) {
  // First try id, fall back to username — same as the legacy two-step.
  const byId = await workerGet(`/v1/admin/profiles/${encodeURIComponent(id)}`);
  if (byId) return byId;
  return await workerGet(`/v1/admin/profiles/by-username/${encodeURIComponent(id)}`);
}

const VERIFIED_SVG =
  '<svg viewBox="0 0 512 512" width="20" height="20" style="flex:0 0 auto" aria-label="verified"><path fill="#3DA5F4" d="M256 16l54 41 67-8 26 62 62 26-8 67 41 54-41 54 8 67-62 26-26 62-67-8-54 41-54-41-67 8-26-62-62-26 8-67-41-54 41-54-8-67 62-26 26-62 67 8z"/><path fill="#fff" d="M369 184L224 329l-81-81-31 31 112 112 176-176z"/></svg>';

interface PageOpts {
  kind: 'post' | 'profile' | 'generic';
  title: string;
  description: string;
  ogImage: string;
  heading: string;
  emoji: string;
  verified?: boolean;
  subline?: string; // @username or tagline
  banner?: string | null; // real profile banner image
  deepLink: string; // san-mes://... path
  bodyHtml: string;
}

function renderPage(opts: PageOpts): string {
  const { title, description, ogImage, heading, emoji, verified, subline, banner, deepLink, bodyHtml } = opts;
  const isProfile = opts.kind === 'profile';
  const coverStyle = banner
    ? `background-image:url('${escapeHtml(banner)}');background-size:cover;background-position:center;`
    : 'background:linear-gradient(135deg,#F7A07E 0%,#E37857 55%,#D7625F 100%);';
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
  <link rel="icon" type="image/png" href="${escapeHtml(FALLBACK_OG_IMAGE)}">
  <link rel="shortcut icon" type="image/png" href="${escapeHtml(FALLBACK_OG_IMAGE)}">
  <link rel="apple-touch-icon" href="${escapeHtml(FALLBACK_OG_IMAGE)}">
  <style>
    *{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent;}
    /* Fully transparent / hidden scrollbars */
    html{scrollbar-width:none;-ms-overflow-style:none;}
    html::-webkit-scrollbar,body::-webkit-scrollbar,*::-webkit-scrollbar{width:0;height:0;background:transparent;display:none;}
    html,body{width:100%;overflow-x:hidden;}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#EDE4FB;min-height:100vh;min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:18px;color:#16181c;}
    .card{position:relative;background:#fff;border-radius:26px;width:100%;max-width:430px;overflow:hidden;box-shadow:0 20px 60px rgba(80,60,120,0.22);}
    /* Telegram-style cover banner */
    .cover{height:132px;position:relative;}
    .cover::after{content:'';position:absolute;inset:0;background:radial-gradient(circle at 78% 20%,rgba(255,255,255,0.18),transparent 45%);}
    .avatar-wrap{position:absolute;left:24px;top:84px;}
    .avatar{width:96px;height:96px;border-radius:30px;background:#FFEFE6;border:4px solid #fff;display:flex;align-items:center;justify-content:center;font-size:50px;box-shadow:0 8px 20px rgba(0,0,0,0.12);}
    .body{padding:60px 24px 24px;}
    .name-row{display:flex;align-items:center;gap:6px;min-width:0;}
    .name{font-size:23px;font-weight:800;letter-spacing:-0.3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;}
    .sub{font-size:15px;color:#8a8d93;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    .content{font-size:16px;line-height:1.55;margin-top:16px;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;color:#16181c;}
    .photo{width:100%;border-radius:18px;margin-top:16px;display:block;}
    .stats{display:flex;gap:18px;margin-top:18px;font-size:15px;color:#8a8d93;font-weight:600;}
    .stats b{color:#16181c;font-weight:700;}
    .actions{margin-top:24px;}
    .btn{display:flex;align-items:center;justify-content:center;gap:8px;background:linear-gradient(135deg,#EC8C6E,#E37857);color:#fff;text-decoration:none;padding:16px;border-radius:16px;font-weight:700;font-size:16px;box-shadow:0 8px 22px rgba(227,120,87,0.4);border:none;width:100%;cursor:pointer;}
    .hint{text-align:center;margin-top:12px;font-size:13px;color:#a7abb2;}
    .foot{display:flex;align-items:center;justify-content:center;gap:6px;margin-top:20px;font-size:13px;color:#c2b8d8;font-weight:600;letter-spacing:0.3px;}
  </style>
</head>
<body>
  <div class="card">
    <div class="cover" style="${coverStyle}"></div>
    <div class="avatar-wrap"><div class="avatar">${emoji || '🌸'}</div></div>
    <div class="body">
      <div class="name-row">
        <span class="name">${escapeHtml(heading)}</span>
        ${verified ? VERIFIED_SVG : ''}
      </div>
      ${subline ? `<div class="sub">${escapeHtml(subline)}</div>` : ''}
      ${bodyHtml}
      <div class="actions">
        <button class="btn" id="openBtn">${isProfile ? 'Открыть профиль в San' : 'Открыть в San'}</button>
        <div class="hint">Нет приложения? Откроется App Store</div>
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
        // If the app opens, the browser tab gets backgrounded/hidden. We watch
        // for that and cancel the App Store fallback so the store never shows
        // when the app actually opened.
        function cancel(){ fired=true; }
        document.addEventListener('visibilitychange',function(){ if(document.hidden) cancel(); });
        window.addEventListener('pagehide',cancel);
        window.addEventListener('blur',cancel);
        // Attempt to open the installed app.
        window.location.href=deep;
        // Fallback to the App Store only if the app did NOT open.
        setTimeout(function(){ if(!fired && !document.hidden){ window.location.href=store; } },1500);
      }
      var b=document.getElementById('openBtn');
      if(b) b.addEventListener('click',openApp);
    })();
  </script>
</body>
</html>`;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const url = req.url || '/';
  const accept = req.headers['accept'] || '';

  if (accept.includes('text/html')) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.statusCode = 200;

    const postMatch = url.match(/\/post\/([^/?#]+)/);
    const profileMatch = url.match(/\/profile\/([^/?#]+)/);

    try {
      if (postMatch) {
        const id = decodeURIComponent(postMatch[1]);
        const post = await fetchPost(id);
        if (post) {
          const author = post.profiles || {};
          const isRepost = typeof post.content === 'string' && post.content.startsWith(REPOST_PREFIX);
          const text = isRepost ? '' : post.content || '';
          const img = firstImage(post.image_url);
          const authorName = author.display_name || author.username || 'Пользователь';
          const title = `${authorName} в San`;
          const description = (text || 'Посмотри эту публикацию в San').slice(0, 160);
          const bodyHtml =
            (text ? `<div class="content">${escapeHtml(text)}</div>` : '') +
            (img ? `<img class="photo" src="${escapeHtml(img)}" alt="">` : '');
          res.end(
            renderPage({
              kind: 'post',
              title,
              description,
              ogImage: img || FALLBACK_OG_IMAGE,
              heading: authorName,
              emoji: author.emoji,
              verified: !!author.is_verified,
              subline: author.username ? `@${author.username}` : undefined,
              banner: author.banner_url || null,
              deepLink: `${APP_SCHEME}://comments/${id}`,
              bodyHtml,
            })
          );
          return;
        }
      } else if (profileMatch) {
        const id = decodeURIComponent(profileMatch[1]);
        const profile = await fetchProfile(id);
        if (profile) {
          const name = profile.display_name || profile.username || 'Профиль';
          const title = `${name} в San`;
          const description = (profile.bio || `Профиль @${profile.username} в San`).slice(0, 160);
          const bodyHtml = profile.bio ? `<div class="content">${escapeHtml(profile.bio)}</div>` : '';
          res.end(
            renderPage({
              kind: 'profile',
              title,
              description,
              ogImage: FALLBACK_OG_IMAGE,
              heading: name,
              emoji: profile.emoji,
              verified: !!profile.is_verified,
              subline: profile.username ? `@${profile.username}` : undefined,
              banner: profile.banner_url || null,
              deepLink: `${APP_SCHEME}://profile/${profile.id || id}`,
              bodyHtml,
            })
          );
          return;
        }
      }
    } catch {
      // fall through to generic page
    }

    res.end(
      renderPage({
        kind: 'generic',
        title: 'San — Социальная сеть',
        description: 'Присоединяйся к San — современная социальная сеть с эмодзи-аватарами',
        ogImage: FALLBACK_OG_IMAGE,
        heading: 'San',
        emoji: '🌸',
        subline: 'Социальная сеть',
        deepLink: `${APP_SCHEME}://`,
        bodyHtml: '<div class="content">Современная социальная сеть с эмодзи-аватарами.</div>',
      })
    );
    return;
  }

  // API JSON response (non-browser clients).
  res.setHeader('Content-Type', 'application/json');
  res.statusCode = 200;
  res.end(
    JSON.stringify({
      app: 'San',
      version: '1.0.0',
      status: 'online',
      download: APP_STORE_LINK,
      api: { health: '/api/health', unfurl: '/api/unfurl' },
    })
  );
}
