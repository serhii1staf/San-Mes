import type { IncomingMessage, ServerResponse } from 'http';

// Public Supabase read access (anon key) to render real post/profile previews.
const SUPABASE_URL = 'https://ycwadqglcykcpucembjn.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inljd2FkcWdsY3lrY3B1Y2VtYmpuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4Mjc2OTYsImV4cCI6MjA5NTQwMzY5Nn0.ZUr1YfN6pBp_AaUC1pZLKGApwgEXEiVw_w6w-yQjE_U';

const APP_LINK = 'https://apps.apple.com/app/id6773943434';
const FALLBACK_OG_IMAGE = 'https://i.postimg.cc/k5jt7kL1/image.png';
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

async function sbGet(path: string): Promise<any[] | null> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    });
    if (!r.ok) return null;
    return (await r.json()) as any[];
  } catch {
    return null;
  }
}

async function fetchPost(id: string) {
  const rows = await sbGet(
    `posts?id=eq.${encodeURIComponent(id)}&select=id,content,image_url,created_at,likes_count,comments_count,author_id,profiles:author_id(username,display_name,emoji,is_verified)&limit=1`
  );
  return rows && rows[0] ? rows[0] : null;
}

async function fetchProfile(id: string) {
  // Allow lookup by id or by username.
  const byId = await sbGet(
    `profiles?id=eq.${encodeURIComponent(id)}&select=id,username,display_name,emoji,bio,is_verified&limit=1`
  );
  if (byId && byId[0]) return byId[0];
  const byName = await sbGet(
    `profiles?username=eq.${encodeURIComponent(id)}&select=id,username,display_name,emoji,bio,is_verified&limit=1`
  );
  return byName && byName[0] ? byName[0] : null;
}

function renderPage(opts: {
  title: string;
  description: string;
  ogImage: string;
  heading: string;
  emoji: string;
  bodyHtml: string;
}): string {
  const { title, description, ogImage, heading, emoji, bodyHtml } = opts;
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
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
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; overflow-x: hidden; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: linear-gradient(160deg, #FFF3E9 0%, #FBE8DC 100%); min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; color: #1a1a1a; }
    .card { background: #fff; border-radius: 28px; padding: 24px; max-width: 420px; width: 100%; box-shadow: 0 12px 40px rgba(180,120,80,0.18); overflow: hidden; }
    .head { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; min-width: 0; }
    .emoji { flex: 0 0 auto; width: 52px; height: 52px; border-radius: 26px; background: #FFEFE6; display: flex; align-items: center; justify-content: center; font-size: 28px; }
    .head-text { min-width: 0; flex: 1 1 auto; }
    .name { font-size: 18px; font-weight: 700; color: #1a1a1a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sub { font-size: 13px; color: #9a9a9a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .content { font-size: 16px; color: #222; line-height: 1.5; margin-bottom: 16px; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; }
    .photo { width: 100%; border-radius: 18px; margin-bottom: 16px; display: block; }
    .stats { font-size: 14px; color: #999; margin-bottom: 22px; }
    .btn { display: block; text-align: center; background: linear-gradient(135deg, #EC8C6E, #E37857); color: #fff; text-decoration: none; padding: 16px 28px; border-radius: 16px; font-weight: 600; font-size: 16px; box-shadow: 0 6px 18px rgba(227,120,87,0.35); }
    .secondary { display: block; text-align: center; margin-top: 14px; color: #E37857; text-decoration: none; font-size: 14px; font-weight: 500; }
    .logo { text-align: center; font-size: 13px; color: #c9b8ad; margin-top: 18px; letter-spacing: 0.5px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="head">
      <div class="emoji">${emoji || '🌸'}</div>
      <div class="head-text">
        <div class="name">${escapeHtml(heading)}</div>
        <div class="sub">San — социальная сеть</div>
      </div>
    </div>
    ${bodyHtml}
    <a class="btn" href="${APP_LINK}">Открыть в San</a>
    <a class="secondary" href="${APP_LINK}">Скачать приложение</a>
    <div class="logo">🌸 San</div>
  </div>
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
        const post = await fetchPost(decodeURIComponent(postMatch[1]));
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
            (img ? `<img class="photo" src="${escapeHtml(img)}" alt="">` : '') +
            `<div class="stats">❤ ${post.likes_count || 0} · 💬 ${post.comments_count || 0}</div>`;
          res.end(
            renderPage({
              title,
              description,
              ogImage: img || FALLBACK_OG_IMAGE,
              heading: authorName,
              emoji: author.emoji,
              bodyHtml,
            })
          );
          return;
        }
      } else if (profileMatch) {
        const profile = await fetchProfile(decodeURIComponent(profileMatch[1]));
        if (profile) {
          const name = profile.display_name || profile.username || 'Профиль';
          const title = `${name} в San`;
          const description = (profile.bio || `Профиль @${profile.username} в San`).slice(0, 160);
          const bodyHtml =
            `<div class="sub" style="margin-bottom:12px">@${escapeHtml(profile.username || '')}</div>` +
            (profile.bio ? `<div class="content">${escapeHtml(profile.bio)}</div>` : '');
          res.end(
            renderPage({
              title,
              description,
              ogImage: FALLBACK_OG_IMAGE,
              heading: name,
              emoji: profile.emoji,
              bodyHtml,
            })
          );
          return;
        }
      }
    } catch {
      // fall through to generic page
    }

    // Generic / not-found fallback page.
    res.end(
      renderPage({
        title: 'San — Социальная сеть',
        description: 'Присоединяйся к San — современная социальная сеть с эмодзи-аватарами',
        ogImage: FALLBACK_OG_IMAGE,
        heading: 'San',
        emoji: '🌸',
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
      download: APP_LINK,
      api: { health: '/api/health', posts: '/api/posts', auth: '/api/auth/login' },
    })
  );
}
