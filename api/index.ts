import type { IncomingMessage, ServerResponse } from 'http';

export default function handler(req: IncomingMessage, res: ServerResponse) {
  const url = req.url || '/';
  const accept = req.headers['accept'] || '';

  // If browser requests HTML (shared links), show a nice page
  if (accept.includes('text/html')) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.statusCode = 200;

    // Extract post/profile ID from URL
    const postMatch = url.match(/\/post\/([^/?]+)/);
    const profileMatch = url.match(/\/profile\/([^/?]+)/);

    let title = 'San — Социальная сеть';
    let description = 'Присоединяйся к San — современная социальная сеть с эмодзи-аватарами';

    if (postMatch) {
      title = 'Публикация в San';
      description = 'Посмотри эту публикацию в приложении San';
    } else if (profileMatch) {
      title = 'Профиль в San';
      description = 'Посмотри этот профиль в приложении San';
    }

    const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <meta name="description" content="${description}">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:image" content="https://i.postimg.cc/k5jt7kL1/image.png">
  <meta property="og:type" content="website">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #FFF8F0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
    .card { background: white; border-radius: 24px; padding: 48px 32px; max-width: 400px; width: 100%; text-align: center; box-shadow: 0 8px 32px rgba(0,0,0,0.08); }
    .logo { font-size: 64px; margin-bottom: 16px; }
    h1 { font-size: 28px; font-weight: 700; color: #1a1a1a; margin-bottom: 8px; }
    p { font-size: 16px; color: #666; line-height: 1.5; margin-bottom: 24px; }
    .btn { display: inline-block; background: #E8856C; color: white; text-decoration: none; padding: 14px 32px; border-radius: 12px; font-weight: 600; font-size: 16px; transition: transform 0.1s; }
    .btn:hover { transform: scale(1.02); }
    .secondary { display: block; margin-top: 16px; color: #E8856C; text-decoration: none; font-size: 14px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">🌸</div>
    <h1>${title}</h1>
    <p>${description}</p>
    <a href="https://expo.dev/accounts/odserser/projects/san-mes" class="btn">Открыть в San</a>
    <a href="https://expo.dev/accounts/odserser/projects/san-mes" class="secondary">Скачать приложение</a>
  </div>
</body>
</html>`;
    res.end(html);
    return;
  }

  // API JSON response
  res.setHeader('Content-Type', 'application/json');
  res.statusCode = 200;
  res.end(
    JSON.stringify({
      app: 'San',
      version: '1.0.0',
      status: 'online',
      download: 'https://expo.dev/accounts/odserser/projects/san-mes',
      api: {
        health: '/api/health',
        posts: '/api/posts',
        auth: '/api/auth/login',
      },
    })
  );
}
