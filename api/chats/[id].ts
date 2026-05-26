import type { IncomingMessage, ServerResponse } from 'http';
import { verifyToken, sendUnauthorized } from '../_middleware';

const mockMessages = [
  {
    id: 'm1',
    conversationId: 'conv1',
    senderId: '1',
    text: 'Hey! How is the new project going?',
    createdAt: '2024-01-15T15:00:00Z',
    isRead: true,
  },
  {
    id: 'm2',
    conversationId: 'conv1',
    senderId: 'current',
    text: 'Really well! Just finished the first draft.',
    createdAt: '2024-01-15T15:05:00Z',
    isRead: true,
  },
  {
    id: 'm3',
    conversationId: 'conv1',
    senderId: '1',
    text: 'That design looks amazing!',
    createdAt: '2024-01-15T16:45:00Z',
    isRead: false,
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
    res.end(JSON.stringify({ success: true, data: mockMessages }));
    return;
  }

  if (req.method === 'POST') {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const { text } = JSON.parse(body);
        const newMessage = {
          id: 'm-' + Date.now(),
          conversationId: 'conv1',
          senderId: 'current',
          text,
          createdAt: new Date().toISOString(),
          isRead: true,
        };
        res.statusCode = 201;
        res.end(JSON.stringify({ success: true, data: newMessage }));
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
