import type { IncomingMessage, ServerResponse } from 'http';

const mockUsers = [
  {
    id: '1',
    username: 'sophia_chen',
    displayName: 'Sophia Chen',
    avatar: 'https://ui-avatars.com/api/?name=Sophia+Chen&background=FF6B6B&color=fff&size=200',
  },
  {
    id: '2',
    username: 'alex_woods',
    displayName: 'Alex Woods',
    avatar: 'https://ui-avatars.com/api/?name=Alex+Woods&background=8FAE8B&color=fff&size=200',
  },
];

const mockPosts = [
  {
    id: 'p1',
    authorName: 'Alex Woods',
    content: 'Golden hour in the forest today.',
    imageUrl: 'https://picsum.photos/seed/forest/400/400',
  },
  {
    id: 'p3',
    authorName: 'Sophia Chen',
    content: 'Redesigned my workspace this weekend.',
    imageUrl: 'https://picsum.photos/seed/desk/400/400',
  },
];

export default function handler(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.end(JSON.stringify({ success: false, message: 'Method not allowed' }));
    return;
  }

  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const query = url.searchParams.get('q') || '';

  const filteredUsers = query
    ? mockUsers.filter((u) =>
        u.displayName.toLowerCase().includes(query.toLowerCase()) ||
        u.username.toLowerCase().includes(query.toLowerCase())
      )
    : mockUsers;

  const filteredPosts = query
    ? mockPosts.filter((p) =>
        p.content.toLowerCase().includes(query.toLowerCase())
      )
    : mockPosts;

  res.statusCode = 200;
  res.end(JSON.stringify({
    success: true,
    data: {
      users: filteredUsers,
      posts: filteredPosts,
    },
  }));
}
