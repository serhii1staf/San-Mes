import type { IncomingMessage, ServerResponse } from 'http';

const mockConversations = [
  {
    id: 'conv1',
    participantId: '1',
    participantName: 'Sophia Chen',
    participantUsername: 'sophia_chen',
    participantAvatar: 'https://ui-avatars.com/api/?name=Sophia+Chen&background=FF6B6B&color=fff&size=200',
    lastMessage: 'That design looks amazing!',
    lastMessageAt: '2024-01-15T16:45:00Z',
    unreadCount: 2,
    isOnline: true,
  },
  {
    id: 'conv2',
    participantId: '2',
    participantName: 'Alex Woods',
    participantUsername: 'alex_woods',
    participantAvatar: 'https://ui-avatars.com/api/?name=Alex+Woods&background=8FAE8B&color=fff&size=200',
    lastMessage: 'Thanks! I will send you the full resolution version.',
    lastMessageAt: '2024-01-15T14:20:00Z',
    unreadCount: 0,
    isOnline: false,
  },
];

export default function handler(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'GET') {
    res.statusCode = 200;
    res.end(JSON.stringify({ success: true, data: mockConversations }));
    return;
  }

  res.statusCode = 405;
  res.end(JSON.stringify({ success: false, message: 'Method not allowed' }));
}
