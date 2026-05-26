import type { IncomingMessage, ServerResponse } from 'http';

export default function handler(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end(JSON.stringify({ success: false, message: 'Method not allowed' }));
    return;
  }

  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const segments = url.pathname.split('/');
  const postId = segments[segments.length - 2];

  res.statusCode = 200;
  res.end(JSON.stringify({
    success: true,
    data: {
      postId,
      isLiked: true,
      likesCount: 235,
    },
  }));
}
