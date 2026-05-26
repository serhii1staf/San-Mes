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
      const { email, password } = JSON.parse(body);

      if (!email || !password) {
        res.statusCode = 400;
        res.end(JSON.stringify({ success: false, message: 'Email and password are required' }));
        return;
      }

      // Mock authentication
      const response = {
        success: true,
        data: {
          token: 'mock-jwt-token-' + Date.now(),
          user: {
            id: 'current',
            username: 'you_here',
            displayName: 'Your Name',
            avatar: 'https://ui-avatars.com/api/?name=Your+Name&background=FF6B6B&color=fff&size=200',
            bio: 'Living my best life.',
            postsCount: 34,
            followersCount: 1247,
            followingCount: 523,
          },
        },
      };

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(response));
    } catch {
      res.statusCode = 400;
      res.end(JSON.stringify({ success: false, message: 'Invalid request body' }));
    }
  });
}
