import type { IncomingMessage, ServerResponse } from 'http';
import { verifyToken, sendUnauthorized } from '../_middleware';

export default function handler(req: IncomingMessage, res: ServerResponse) {
  const { authorized } = verifyToken(req);
  if (!authorized) {
    sendUnauthorized(res);
    return;
  }

  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const segments = url.pathname.split('/');
  const id = segments[segments.length - 1];

  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'GET') {
    const post = {
      id,
      authorId: '2',
      authorName: 'Alex Woods',
      authorUsername: 'alex_woods',
      authorAvatar: 'https://ui-avatars.com/api/?name=Alex+Woods&background=8FAE8B&color=fff&size=200',
      content: 'Golden hour in the forest today.',
      imageUrl: 'https://picsum.photos/seed/forest/800/600',
      likesCount: 234,
      commentsCount: 18,
      sharesCount: 12,
      isLiked: false,
      isBookmarked: false,
      createdAt: '2024-01-15T17:30:00Z',
    };
    res.statusCode = 200;
    res.end(JSON.stringify({ success: true, data: post }));
    return;
  }

  if (req.method === 'DELETE') {
    res.statusCode = 200;
    res.end(JSON.stringify({ success: true, message: 'Post deleted' }));
    return;
  }

  res.statusCode = 405;
  res.end(JSON.stringify({ success: false, message: 'Method not allowed' }));
}
