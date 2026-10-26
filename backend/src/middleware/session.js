import crypto from 'crypto';
import { redis } from '../redis.js';

/**
 * Create a new user session stored in Redis Hash with 1-hour sliding TTL
 */
export async function createSession(userId, username, ip = '127.0.0.1') {
  const token = crypto.randomBytes(32).toString('hex');
  const key = `session:${token}`;

  const pipeline = redis.pipeline();
  // Redis command: HSET session:<token> userId username createdAt ip
  pipeline.hset(key, {
    userId: userId.toString(),
    username: username.toString(),
    createdAt: Date.now().toString(),
    ip: ip.toString()
  });
  // Redis command: EXPIRE session:<token> 3600 (1 hour initial TTL)
  pipeline.expire(key, 3600);
  await pipeline.exec();

  return token;
}

/**
 * Destroy session on logout
 */
export async function destroySession(token) {
  if (!token) return;
  const key = `session:${token}`;
  // Redis command: DEL session:<token>
  await redis.del(key);
}

/**
 * Express middleware to authenticate requests via Bearer token
 * Implements sliding expiration by refreshing the TTL on each authenticated request
 */
export async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required. Bearer token missing.'
      }
    });
  }

  const token = authHeader.split(' ')[1];
  const key = `session:${token}`;

  // Redis command: HGETALL session:<token>
  // Retrieves session data stored as a Redis Hash
  const session = await redis.hgetall(key);

  if (!session || !session.userId) {
    return res.status(401).json({
      error: {
        code: 'SESSION_EXPIRED',
        message: 'Invalid or expired session. Please log in again.'
      }
    });
  }

  // Sliding expiry: Refresh session TTL by 3600 seconds on active request
  // Redis command: EXPIRE session:<token> 3600
  await redis.expire(key, 3600);

  // Attach session data to request object
  req.user = {
    userId: session.userId,
    username: session.username,
    createdAt: session.createdAt,
    ip: session.ip
  };
  req.token = token;

  next();
}
