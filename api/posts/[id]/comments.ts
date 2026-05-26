import type { IncomingMessage, ServerResponse } from 'http';

const mockComments = [
  {
    id: 'c1',
    postId: 'p1',
    authorId: '1',
    authorName: 'Sophia Chen',
    authorAvatar: 'https://ui-avatars.com/api/?name=Sophia+Chen&background=FF6B6B&color=fff&size=200',
    content: 'This is absolutely stunning!',
    likesCount: 12,
    isLiked: false,
    createdAt: '2024-01-15T18:00:00Z',
  },
  {
    id: 'c2',
    postId: 'p1',
    authorId: '5',
    authorName: 'Emma Liu',
    authorAvatar: 'https://ui-avatars.com/api/?name=Emma+Liu&background=D14E4E&color=fff&size=200',
    content: 'Nature really is the best artist.',
    likesCount: 8,
    isLiked: true,
    createdAt: '2024-01-15T18:30:00Z',
  },
];

export default function handler(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'GET') {
    res.statusCode = 200;
    res.end(JSON.stringify({ success: true, data: mockComments }));
    return;
  }

  if (req.method === 'POST') {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const { content } = JSON.parse(body);
        const newComment = {
          id: 'c-' + Date.now(),
          postId: 'p1',
          authorId: 'current',
          authorName: 'Your Name',
          authorAvatar: 'https://ui-avatars.com/api/?name=Your+Name&background=FF6B6B&color=fff&size=200',
          content,
          likesCount: 0,
          isLiked: false,
          createdAt: new Date().toISOString(),
        };
        res.statusCode = 201;
        res.end(JSON.stringify({ success: true, data: newComment }));
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
