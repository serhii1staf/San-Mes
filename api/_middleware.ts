import type { IncomingMessage, ServerResponse } from 'http';

/**
 * Stub bearer-token verification for non-public API endpoints.
 * In production, this would validate a JWT against a secret or
 * call an auth service. For now it checks that a Bearer token is present.
 */
export function verifyToken(req: IncomingMessage): { authorized: boolean; userId?: string } {
  const authHeader = req.headers['authorization'] || '';
  if (!authHeader.startsWith('Bearer ')) {
    return { authorized: false };
  }
  const token = authHeader.slice(7);
  if (!token || token.length < 5) {
    return { authorized: false };
  }
  // Stub: accept any non-empty token and extract a mock user ID
  return { authorized: true, userId: 'current' };
}

/**
 * Sends a 401 Unauthorized response.
 */
export function sendUnauthorized(res: ServerResponse): void {
  res.statusCode = 401;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ success: false, message: 'Unauthorized: Bearer token required' }));
}
