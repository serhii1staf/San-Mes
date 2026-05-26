import type { IncomingMessage, ServerResponse } from 'http';

const mockUsers: Record<string, object> = {
  '1': {
    id: '1',
    username: 'sophia_chen',
    displayName: 'Sophia Chen',
    avatar: 'https://ui-avatars.com/api/?name=Sophia+Chen&background=FF6B6B&color=fff&size=200',
    bio: 'Designer & coffee enthusiast.',
    postsCount: 142,
    followersCount: 3280,
    followingCount: 891,
  },
  '2': {
    id: '2',
    username: 'alex_woods',
    displayName: 'Alex Woods',
    avatar: 'https://ui-avatars.com/api/?name=Alex+Woods&background=8FAE8B&color=fff&size=200',
    bio: 'Nature photographer.',
    postsCount: 87,
    followersCount: 5620,
    followingCount: 312,
  },
};

export default function handler(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const segments = url.pathname.split('/');
  const id = segments[segments.length - 1];

  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'GET') {
    const user = mockUsers[id || ''];
    if (user) {
      res.statusCode = 200;
      res.end(JSON.stringify({ success: true, data: user }));
    } else {
      res.statusCode = 404;
      res.end(JSON.stringify({ success: false, message: 'User not found' }));
    }
    return;
  }

  if (req.method === 'PUT') {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const updates = JSON.parse(body);
        res.statusCode = 200;
        res.end(JSON.stringify({ success: true, data: { id, ...updates } }));
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
