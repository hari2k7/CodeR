import { redis } from '../redis.js';

/**
 * Generic Rate Limiting Check using Redis INCR + EXPIRE
 *
 * Pattern:
 * 1. INCR key: Atomically increments integer counter. Returns new value.
 * 2. If new value is 1, set EXPIRE windowSeconds so key cleans up automatically.
 * 3. If new value exceeds maxLimit, query TTL to report retryAfter.
 */
export async function checkRateLimit(key, maxLimit, windowSeconds) {
  // Redis command: INCR key
  // Atomically increments counter in Redis
  const count = await redis.incr(key);

  if (count === 1) {
    // Redis command: EXPIRE key seconds
    // First request in window initializes the TTL
    await redis.expire(key, windowSeconds);
  }

  if (count > maxLimit) {
    // Redis command: TTL key
    // Returns remaining seconds before key expires
    const ttl = await redis.ttl(key);
    return {
      allowed: false,
      current: count,
      retryAfter: Math.max(ttl, 1)
    };
  }

  return {
    allowed: true,
    current: count,
    retryAfter: 0
  };
}

/**
 * Express middleware to prevent brute-force attacks on login
 * Tracks failed attempts per IP address in `rl:login:{ip}` with a 15-minute (900s) lockout
 */
export async function loginBruteForceGuard(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || '127.0.0.1';
  const key = `rl:login:${ip}`;

  // Redis command: GET key
  const attempts = await redis.get(key);
  if (attempts && parseInt(attempts, 10) >= 5) {
    // Redis command: TTL key
    const ttl = await redis.ttl(key);
    return res.status(429).json({
      error: {
        code: 'ACCOUNT_LOCKED',
        message: `Too many failed login attempts. Locked for ${ttl} seconds.`,
        retryAfter: Math.max(ttl, 1)
      }
    });
  }

  next();
}

/**
 * Record a failed login attempt for an IP
 */
export async function recordLoginFailure(ip) {
  const key = `rl:login:${ip}`;
  // Redis command: INCR key
  const count = await redis.incr(key);
  if (count === 1) {
    // Redis command: EXPIRE key seconds (15 minutes lockout window)
    await redis.expire(key, 900);
  }
  return count;
}

/**
 * Clear failed login attempts after a successful login
 */
export async function clearLoginFailure(ip) {
  const key = `rl:login:${ip}`;
  // Redis command: DEL key
  await redis.del(key);
}

/**
 * OTP Resend Rate Limiter: Max 3 resends per 10 minutes (600s) per email
 */
export async function checkOtpResendRateLimit(email) {
  const key = `rl:otp:${email.toLowerCase()}`;
  return await checkRateLimit(key, 3, 600);
}

/**
 * OTP Verify Failure Tracker: Max 5 incorrect guesses allowed before invalidation
 */
export async function recordOtpFailure(email) {
  const key = `rl:otpfail:${email.toLowerCase()}`;
  // Redis command: INCR key
  const count = await redis.incr(key);
  if (count === 1) {
    // Redis command: EXPIRE key seconds
    await redis.expire(key, 600);
  }
  return count;
}

/**
 * Clear OTP failure counter
 */
export async function clearOtpFailures(email) {
  const key = `rl:otpfail:${email.toLowerCase()}`;
  // Redis command: DEL key
  await redis.del(key);
}
