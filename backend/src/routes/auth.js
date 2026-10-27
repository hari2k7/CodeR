import express from 'express';
import bcrypt from 'bcrypt';
import { redis } from '../redis.js';
import { generateOTP, sendOTPEmail, storeOTP, storePendingRegistration } from '../services/otp.js';
import {
  checkOtpResendRateLimit,
  recordOtpFailure,
  clearOtpFailures,
  loginBruteForceGuard,
  recordLoginFailure,
  clearLoginFailure
} from '../middleware/rateLimit.js';
import { createSession, destroySession, requireAuth } from '../middleware/session.js';

const router = express.Router();

/**
 * POST /auth/register
 * Step 1 of registration: validates input, ensures uniqueness, stores pending Hash, generates OTP
 */
router.post('/register', async (req, res) => {
  try {
    const { username, email, password, college } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({
        error: { code: 'BAD_REQUEST', message: 'Username, email, and password are required.' }
      });
    }

    if (username.length < 3 || username.length > 20) {
      return res.status(400).json({
        error: { code: 'INVALID_USERNAME', message: 'Username must be between 3 and 20 characters.' }
      });
    }

    const cleanEmail = email.toLowerCase().trim();
    const cleanUsername = username.trim();

    // Check username uniqueness via Bloom Filter (if enabled) or Set fallback
    if (process.env.ENABLE_BLOOM_MODULE === 'true') {
      try {
        // Redis command: BF.EXISTS key item
        const existsInBloom = await redis.call('BF.EXISTS', 'bf:usernames', cleanUsername);
        if (existsInBloom === 1) {
          // Bloom can have false positives, double check with exact key
          const exactUserId = await redis.get(`user:name:${cleanUsername}`);
          if (exactUserId) {
            return res.status(409).json({
              error: { code: 'USERNAME_TAKEN', message: 'Username is already taken.' }
            });
          }
        }
      } catch (bfErr) {
        // Fallback to exact key if Bloom command is unavailable
      }
    }

    // Check exact uniqueness lookup keys
    // Redis command: GET user:name:<username>
    const existingNameId = await redis.get(`user:name:${cleanUsername}`);
    if (existingNameId) {
      return res.status(409).json({
        error: { code: 'USERNAME_TAKEN', message: 'Username is already taken.' }
      });
    }

    // Redis command: GET user:email:<email>
    const existingEmailId = await redis.get(`user:email:${cleanEmail}`);
    if (existingEmailId) {
      return res.status(409).json({
        error: { code: 'EMAIL_REGISTERED', message: 'Email address is already registered.' }
      });
    }

    // Rate limit check for OTP generation per email
    const rl = await checkOtpResendRateLimit(cleanEmail);
    if (!rl.allowed) {
      return res.status(429).json({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many OTP requests for this email. Try again later.',
          retryAfter: rl.retryAfter
        }
      });
    }

    // Hash password with bcrypt
    const passwordHash = await bcrypt.hash(password, 10);

    // Store pending registration data as a Redis Hash with 600s TTL
    await storePendingRegistration(cleanEmail, {
      username: cleanUsername,
      email: cleanEmail,
      passwordHash,
      college: college || ''
    });

    // Generate 6-digit OTP and store in Redis String with 300s TTL (SET otp:<email> <code> EX 300)
    const otp = generateOTP();
    await storeOTP(cleanEmail, otp);

    // Dispatch OTP email (or log to console in demo mode)
    await sendOTPEmail(cleanEmail, otp);

    return res.status(200).json({
      success: true,
      message: 'Registration initiated. OTP sent to email (valid for 5 minutes).',
      email: cleanEmail
    });
  } catch (err) {
    console.error('[Auth Register Error]', err);
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: err.message }
    });
  }
});

/**
 * POST /auth/verify-otp
 * Step 2 of registration: verifies OTP, checks brute-force threshold, creates user and session
 */
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    const ip = req.ip || req.connection.remoteAddress || '127.0.0.1';

    if (!email || !otp) {
      return res.status(400).json({
        error: { code: 'BAD_REQUEST', message: 'Email and OTP are required.' }
      });
    }

    const cleanEmail = email.toLowerCase().trim();

    // Guard against brute-force verification: Max 5 wrong attempts
    // Redis command: GET rl:otpfail:<email>
    const failAttempts = await redis.get(`rl:otpfail:${cleanEmail}`);
    if (failAttempts && parseInt(failAttempts, 10) >= 5) {
      // Invalidate the OTP and pending registration
      // Redis commands: DEL otp:<email>, DEL pending:<email>
      await redis.del(`otp:${cleanEmail}`, `pending:${cleanEmail}`);
      return res.status(429).json({
        error: {
          code: 'OTP_MAX_ATTEMPTS_EXCEEDED',
          message: 'Too many incorrect OTP attempts. The OTP has been invalidated. Please register again.'
        }
      });
    }

    // Check OTP stored in Redis
    // Redis command: GET otp:<email>
    const storedOtp = await redis.get(`otp:${cleanEmail}`);
    if (!storedOtp) {
      return res.status(400).json({
        error: { code: 'OTP_EXPIRED', message: 'OTP has expired or was not requested.' }
      });
    }

    if (storedOtp !== otp.trim()) {
      const attempts = await recordOtpFailure(cleanEmail);
      return res.status(400).json({
        error: {
          code: 'INVALID_OTP',
          message: `Invalid OTP code. (${attempts}/5 failed attempts before lockout)`
        }
      });
    }

    // Retrieve pending registration Hash
    // Redis command: HGETALL pending:<email>
    const pending = await redis.hgetall(`pending:${cleanEmail}`);
    if (!pending || !pending.username) {
      return res.status(400).json({
        error: { code: 'PENDING_EXPIRED', message: 'Registration record has expired. Please register again.' }
      });
    }

    // Atomic User ID sequence generation
    // Redis command: INCR user:id_seq
    const userId = await redis.incr('user:id_seq');

    // Enforce atomic unique email and username bindings via SETNX
    // Redis command: SETNX user:name:<username> <userId>
    const nameLock = await redis.setnx(`user:name:${pending.username}`, userId);
    // Redis command: SETNX user:email:<email> <userId>
    const emailLock = await redis.setnx(`user:email:${cleanEmail}`, userId);

    if (nameLock === 0 || emailLock === 0) {
      // Race condition occurred: cleanup key created
      if (nameLock === 1) await redis.del(`user:name:${pending.username}`);
      if (emailLock === 1) await redis.del(`user:email:${cleanEmail}`);
      return res.status(409).json({
        error: { code: 'CONFLICT', message: 'Username or email was taken by a concurrent request.' }
      });
    }

    // Store user profile Hash
    // Redis command: HSET user:<id> ...
    await redis.hset(`user:${userId}`, {
      id: userId.toString(),
      username: pending.username,
      email: cleanEmail,
      passwordHash: pending.passwordHash,
      rating: '1200',
      solved: '0',
      college: pending.college || '',
      createdAt: Date.now().toString()
    });

    // Add username to set of usernames for fast availability checks
    // Redis command: SADD usernames <username>
    await redis.sadd('usernames', pending.username);

    // If Bloom filter enabled, add to Bloom filter
    if (process.env.ENABLE_BLOOM_MODULE === 'true') {
      try {
        // Redis command: BF.ADD bf:usernames <username>
        await redis.call('BF.ADD', 'bf:usernames', pending.username);
      } catch (bfErr) {
        // Non-blocking if Bloom filter wasn't initialized
      }
    }

    // Cleanup ephemeral keys
    // Redis commands: DEL otp:<email>, DEL pending:<email>, DEL rl:otpfail:<email>
    await redis.del(`otp:${cleanEmail}`, `pending:${cleanEmail}`);
    await clearOtpFailures(cleanEmail);

    // Create user session Hash with 1-hour sliding TTL
    const token = await createSession(userId, pending.username, ip);

    return res.status(201).json({
      success: true,
      token,
      user: {
        id: userId,
        username: pending.username,
        email: cleanEmail,
        rating: 1200,
        solved: 0,
        college: pending.college || ''
      }
    });
  } catch (err) {
    console.error('[Auth Verify OTP Error]', err);
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: err.message }
    });
  }
});

/**
 * POST /auth/resend-otp
 * Resend OTP with strict rate limiting (max 3 per 10 minutes)
 */
router.post('/resend-otp', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({
        error: { code: 'BAD_REQUEST', message: 'Email is required.' }
      });
    }

    const cleanEmail = email.toLowerCase().trim();

    // Verify pending registration exists
    // Redis command: EXISTS pending:<email>
    const exists = await redis.exists(`pending:${cleanEmail}`);
    if (!exists) {
      return res.status(400).json({
        error: { code: 'NO_PENDING_REGISTRATION', message: 'No pending registration found for this email.' }
      });
    }

    // Check rate limit: max 3 requests per 10 minutes (rl:otp:<email>)
    const rl = await checkOtpResendRateLimit(cleanEmail);
    if (!rl.allowed) {
      return res.status(429).json({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many OTP requests. Please wait before requesting another.',
          retryAfter: rl.retryAfter
        }
      });
    }

    // Generate new OTP and store with 300s TTL (SET otp:<email> <code> EX 300)
    const otp = generateOTP();
    await storeOTP(cleanEmail, otp);
    await sendOTPEmail(cleanEmail, otp);

    return res.status(200).json({
      success: true,
      message: 'A new OTP has been sent to your email.'
    });
  } catch (err) {
    console.error('[Auth Resend OTP Error]', err);
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: err.message }
    });
  }
});

/**
 * POST /auth/login
 * Authenticates user, protected by loginBruteForceGuard (max 5 failed attempts -> 15 min lock)
 */
router.post('/login', loginBruteForceGuard, async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress || '127.0.0.1';
  try {
    const { identifier, password } = req.body;
    if (!identifier || !password) {
      return res.status(400).json({
        error: { code: 'BAD_REQUEST', message: 'Identifier (username or email) and password are required.' }
      });
    }

    const cleanIdentifier = identifier.trim();

    // Resolve userId via email or username index
    let userId = null;
    if (cleanIdentifier.includes('@')) {
      // Redis command: GET user:email:<email>
      userId = await redis.get(`user:email:${cleanIdentifier.toLowerCase()}`);
    } else {
      // Redis command: GET user:name:<username>
      userId = await redis.get(`user:name:${cleanIdentifier}`);
    }

    if (!userId) {
      await recordLoginFailure(ip);
      return res.status(401).json({
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username/email or password.' }
      });
    }

    // Fetch user profile Hash
    // Redis command: HGETALL user:<id>
    const user = await redis.hgetall(`user:${userId}`);
    if (!user || !user.passwordHash) {
      await recordLoginFailure(ip);
      return res.status(401).json({
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username/email or password.' }
      });
    }

    // Verify bcrypt password
    const passwordMatch = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatch) {
      const attempts = await recordLoginFailure(ip);
      return res.status(401).json({
        error: {
          code: 'INVALID_CREDENTIALS',
          message: `Invalid username/email or password. (${attempts}/5 failed attempts before lockout)`
        }
      });
    }

    // Successful login: reset lockout counter
    await clearLoginFailure(ip);

    // Create session stored in Redis Hash with 1-hour sliding TTL
    const token = await createSession(userId, user.username, ip);

    return res.status(200).json({
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        rating: parseInt(user.rating || '1200', 10),
        solved: parseInt(user.solved || '0', 10),
        college: user.college || ''
      }
    });
  } catch (err) {
    console.error('[Auth Login Error]', err);
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: err.message }
    });
  }
});

/**
 * POST /auth/logout
 * Destroys session in Redis
 */
router.post('/logout', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      // Redis command: DEL session:<token>
      await destroySession(token);
    }
    return res.status(200).json({
      success: true,
      message: 'Logged out successfully.'
    });
  } catch (err) {
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: err.message }
    });
  }
});

/**
 * GET /auth/me
 * Returns current authenticated user profile
 */
router.get('/me', requireAuth, async (req, res) => {
  try {
    // Redis command: HGETALL user:<id>
    const user = await redis.hgetall(`user:${req.user.userId}`);
    if (!user || !user.id) {
      return res.status(404).json({
        error: { code: 'USER_NOT_FOUND', message: 'User profile not found.' }
      });
    }

    return res.status(200).json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        rating: parseInt(user.rating || '1200', 10),
        solved: parseInt(user.solved || '0', 10),
        college: user.college || '',
        createdAt: user.createdAt
      }
    });
  } catch (err) {
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: err.message }
    });
  }
});

/**
 * PUT /auth/me
 * Update authenticated user's username or college
 *
 * Demonstrates:
 *   - Atomic username uniqueness transition via SETNX
 *   - Redis Hash field updates via HSET
 *   - Real-time adjustment of university Sorted Set lb:college
 */
router.put('/me', requireAuth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { username, college } = req.body;

    // Fetch existing profile
    // Redis command: HGETALL user:<id>
    const user = await redis.hgetall(`user:${userId}`);
    if (!user || !user.id) {
      return res.status(404).json({
        error: { code: 'USER_NOT_FOUND', message: 'User profile not found.' }
      });
    }

    const updates = {};
    const oldUsername = user.username;
    const oldCollege = user.college || '';

    // 1. Username Update
    if (username && username.trim() !== oldUsername) {
      const cleanUsername = username.trim();
      if (cleanUsername.length < 3 || cleanUsername.length > 20) {
        return res.status(400).json({
          error: { code: 'INVALID_USERNAME', message: 'Username must be between 3 and 20 characters.' }
        });
      }

      // Check / claim new username atomically
      // Redis command: SETNX user:name:<newUsername> <userId>
      const lockAcquired = await redis.setnx(`user:name:${cleanUsername}`, userId);
      if (lockAcquired === 0) {
        return res.status(409).json({
          error: { code: 'USERNAME_TAKEN', message: 'Username is already taken by another user.' }
        });
      }

      // Remove old username index and update set
      // Redis commands: DEL user:name:<oldUsername>, SREM usernames, SADD usernames
      await redis.del(`user:name:${oldUsername}`);
      await redis.srem('usernames', oldUsername);
      await redis.sadd('usernames', cleanUsername);

      if (process.env.ENABLE_BLOOM_MODULE === 'true') {
        try {
          await redis.call('BF.ADD', 'bf:usernames', cleanUsername);
        } catch {}
      }

      updates.username = cleanUsername;

      // Update username in active session Hash
      // Redis command: HSET session:<token> username <cleanUsername>
      await redis.hset(`session:${req.token}`, 'username', cleanUsername);
    }

    // 2. College Update
    if (college !== undefined && college.trim() !== oldCollege) {
      const cleanCollege = college.trim();
      updates.college = cleanCollege;

      // Adjust college leaderboard score if user had points
      // Redis command: ZSCORE lb:global <userId>
      const scoreStr = await redis.zscore('lb:global', userId);
      const score = parseInt(scoreStr || '0', 10);

      if (score > 0) {
        if (oldCollege) {
          // Redis command: ZINCRBY lb:college -score <oldCollege>
          await redis.zincrby('lb:college', -score, oldCollege);
        }
        if (cleanCollege) {
          // Redis command: ZINCRBY lb:college score <newCollege>
          await redis.zincrby('lb:college', score, cleanCollege);
        }
      }
    }

    if (Object.keys(updates).length > 0) {
      // Redis command: HSET user:<id> ...
      await redis.hset(`user:${userId}`, updates);
    }

    // Fetch updated user
    const updatedUser = await redis.hgetall(`user:${userId}`);

    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully.',
      user: {
        id: updatedUser.id,
        username: updatedUser.username,
        email: updatedUser.email,
        rating: parseInt(updatedUser.rating || '1200', 10),
        solved: parseInt(updatedUser.solved || '0', 10),
        college: updatedUser.college || '',
        createdAt: updatedUser.createdAt
      }
    });
  } catch (err) {
    console.error('[Update Profile Error]', err);
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: err.message }
    });
  }
});

/**
 * DELETE /auth/me
 * Permanently deletes user account, lookup keys, session, and associated Redis records
 *
 * Demonstrates:
 *   - Comprehensive multi-key purge in Redis
 *   - ZREM from Sorted Set leaderboards (lb:global, lb:contest:1)
 *   - Delta adjustments on aggregate university leaderboard (lb:college)
 */
router.delete('/me', requireAuth, async (req, res) => {
  try {
    const userId = req.user.userId;

    // Fetch user profile to identify associated keys
    // Redis command: HGETALL user:<id>
    const user = await redis.hgetall(`user:${userId}`);
    if (!user || !user.id) {
      return res.status(404).json({
        error: { code: 'USER_NOT_FOUND', message: 'User profile not found.' }
      });
    }

    // Check user's current score
    // Redis command: ZSCORE lb:global <userId>
    const scoreStr = await redis.zscore('lb:global', userId);
    const score = parseInt(scoreStr || '0', 10);

    const pipeline = redis.pipeline();

    // 1. Remove lookup keys
    if (user.username) {
      // Redis command: DEL user:name:<username>
      pipeline.del(`user:name:${user.username}`);
      // Redis command: SREM usernames <username>
      pipeline.srem('usernames', user.username);
    }
    if (user.email) {
      // Redis command: DEL user:email:<email>
      pipeline.del(`user:email:${user.email.toLowerCase()}`);
    }

    // 2. Remove user Hash
    // Redis command: DEL user:<id>
    pipeline.del(`user:${userId}`);

    // 3. Remove user from global and contest leaderboards
    // Redis commands: ZREM lb:global <userId>, ZREM lb:contest:1 <userId>
    pipeline.zrem('lb:global', userId);
    pipeline.zrem('lb:contest:1', userId);

    // 4. Adjust college leaderboard if user contributed points
    if (score > 0 && user.college) {
      // Redis command: ZINCRBY lb:college -score <college>
      pipeline.zincrby('lb:college', -score, user.college);
    }

    // 5. Remove solved set, submission history list, streak bitmap
    // Redis commands: DEL solved:<userId>, DEL user:<userId>:history, DEL streak:<userId>:2026
    pipeline.del(`solved:${userId}`);
    pipeline.del(`user:${userId}:history`);
    pipeline.del(`streak:${userId}:2026`);

    // 6. Invalidate active session
    // Redis command: DEL session:<token>
    pipeline.del(`session:${req.token}`);

    await pipeline.exec();

    return res.status(200).json({
      success: true,
      message: 'Account and associated Redis data deleted successfully.'
    });
  } catch (err) {
    console.error('[Delete Account Error]', err);
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: err.message }
    });
  }
});

export default router;
