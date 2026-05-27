import type { IncomingMessage, ServerResponse } from 'http';

export default function handler(req: IncomingMessage, res: ServerResponse) {
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
