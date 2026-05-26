import type { IncomingMessage, ServerResponse } from 'http';

export default function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end(JSON.stringify({ success: false, message: 'Method not allowed' }));
    return;
  }

  let body = '';
  req.on('data', (chunk: Buffer) => {
    body += chunk.toString();
  });

  req.on('end', () => {
    try {
      const { name, email, password } = JSON.parse(body);

      if (!name || !email || !password) {
        res.statusCode = 400;
        res.end(JSON.stringify({ success: false, message: 'Name, email, and password are required' }));
        return;
      }

      const username = name.toLowerCase().replace(/\s+/g, '_');
      const response = {
        success: true,
        data: {
          token: 'mock-jwt-token-' + Date.now(),
          user: {
            id: 'user-' + Date.now(),
            username,
            displayName: name,
            avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=FF6B6B&color=fff&size=200`,
            bio: '',
            postsCount: 0,
            followersCount: 0,
            followingCount: 0,
          },
        },
      };

      res.statusCode = 201;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(response));
    } catch {
      res.statusCode = 400;
      res.end(JSON.stringify({ success: false, message: 'Invalid request body' }));
    }
  });
}
