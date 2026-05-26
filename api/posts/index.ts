import type { IncomingMessage, ServerResponse } from 'http';
import { verifyToken, sendUnauthorized } from '../_middleware';

const mockPosts = [
  {
    id: 'p1',
    authorId: '2',
    authorName: 'Alex Woods',
    authorUsername: 'alex_woods',
    authorAvatar: 'https://ui-avatars.com/api/?name=Alex+Woods&background=8FAE8B&color=fff&size=200',
    content: 'Golden hour in the forest today. Sometimes the best moments are the quietest ones.',
    imageUrl: 'https://picsum.photos/seed/forest/800/600',
    likesCount: 234,
    commentsCount: 18,
    sharesCount: 12,
    isLiked: false,
    isBookmarked: false,
    createdAt: '2024-01-15T17:30:00Z',
  },
  {
    id: 'p2',
    authorId: '3',
    authorName: 'Mia Jackson',
    authorUsername: 'mia_jackson',
    authorAvatar: 'https://ui-avatars.com/api/?name=Mia+Jackson&background=F4C553&color=fff&size=200',
    content: 'New recipe alert! This sourdough took 3 days but every minute was worth it.',
    imageUrl: 'https://picsum.photos/seed/bread/800/800',
    likesCount: 567,
    commentsCount: 45,
    sharesCount: 89,
    isLiked: true,
    isBookmarked: true,
    createdAt: '2024-01-15T14:00:00Z',
  },
];

export default function handler(req: IncomingMessage, res: ServerResponse) {
  const { authorized } = verifyToken(req);
  if (!authorized) {
    sendUnauthorized(res);
    return;
  }

  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'GET') {
    res.statusCode = 200;
    res.end(JSON.stringify({ success: true, data: mockPosts }));
    return;
  }

  if (req.method === 'POST') {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const postData = JSON.parse(body);
        // Issue 4: Whitelist specific fields instead of spreading untrusted input
        const content = typeof postData.content === 'string' ? postData.content : '';
        const imageUrl = typeof postData.imageUrl === 'string' ? postData.imageUrl : undefined;
        const newPost = {
          id: 'p-' + Date.now(),
          authorId: 'current',
          authorName: 'Your Name',
          authorUsername: 'you_here',
          authorAvatar: 'https://ui-avatars.com/api/?name=Your+Name&background=FF6B6B&color=fff&size=200',
          content,
          imageUrl,
          likesCount: 0,
          commentsCount: 0,
          sharesCount: 0,
          isLiked: false,
          isBookmarked: false,
          createdAt: new Date().toISOString(),
        };
        res.statusCode = 201;
        res.end(JSON.stringify({ success: true, data: newPost }));
      } catch {
        res.statusCode = 400;
        res.end(JSON.stringify({ success: false, message: 'Invalid body' }));
      }
    });
    return;
  }

  res.statusCode = 405;
  res.end(JSON.stringify({ success: false, message: 'Method not allowed' }));
}
