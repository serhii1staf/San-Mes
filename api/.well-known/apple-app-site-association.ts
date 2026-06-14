import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Content-Type', 'application/json');
  res.status(200).json({
    applinks: {
      apps: [],
      details: [
        {
          appIDs: ['SY2H67GC49.com.sanmes.app'],
          paths: ['/profile/*', '/post/*', '/mini/*'],
        },
      ],
    },
  });
}
