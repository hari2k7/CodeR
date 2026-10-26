import express from 'express';
import { redis } from '../redis.js';
import { requireAuth } from '../middleware/session.js';

const router = express.Router();

/**
 * GET /leaderboard
 * Query params:
 *   - limit: integer (default 20, max 100)
 *   - offset: integer (default 0)
 *   - contestId: optional contest identifier (queries lb:contest:<id>)
 *
 * Demonstrates:
 *   - ZREVRANGE lb:global <start> <stop> WITHSCORES (Sorted Set descending score retrieval)
 *   - Pipeline HGETALL user:<id> (O(1) profile hydration)
 *   - SET cache:lb:top100 <json> EX 5 (Transient TTL caching with X-Cache HIT/MISS header)
 */
router.get('/', async (req, res) => {
  try {
    const { limit = 20, offset = 0, contestId } = req.query;
    const parsedLimit = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
    const parsedOffset = Math.max(0, parseInt(offset, 10) || 0);

    const isTop100Global = !contestId && parsedOffset === 0 && parsedLimit <= 100;

    // Check 5-second transient cache for top-100 global leaderboard
    if (isTop100Global) {
      // Redis command: GET cache:lb:top100
      const cached = await redis.get('cache:lb:top100');
      if (cached) {
        res.setHeader('X-Cache', 'HIT');
        return res.status(200).json(JSON.parse(cached));
      }
    }

    res.setHeader('X-Cache', isTop100Global ? 'MISS' : 'BYPASS');

    const leaderboardKey = contestId ? `lb:contest:${contestId}` : 'lb:global';

    // Total participants in the sorted set
    // Redis command: ZCARD lb:<key>
    const totalParticipants = await redis.zcard(leaderboardKey);

    const start = parsedOffset;
    const stop = parsedOffset + parsedLimit - 1;

    // Retrieve sorted set members with scores in descending order
    // Redis command: ZREVRANGE lb:global <start> <stop> WITHSCORES
    const zrevResults = await redis.zrevrange(leaderboardKey, start, stop, 'WITHSCORES');

    if (zrevResults.length === 0) {
      const emptyResult = {
        total: totalParticipants,
        limit: parsedLimit,
        offset: parsedOffset,
        contestId: contestId || null,
        leaderboard: []
      };
      return res.status(200).json(emptyResult);
    }

    // Parse member and score pairs
    const entries = [];
    const pipeline = redis.pipeline();

    for (let i = 0; i < zrevResults.length; i += 2) {
      const memberUserId = zrevResults[i];
      const score = parseInt(zrevResults[i + 1], 10);
      entries.push({ userId: memberUserId, score });
      // Redis command: HGETALL user:<id>
      pipeline.hgetall(`user:${memberUserId}`);
    }

    const profiles = await pipeline.exec();

    const leaderboard = entries.map((entry, idx) => {
      const rank = parsedOffset + idx + 1;
      const userHash = profiles[idx] ? profiles[idx][1] : {};

      return {
        rank,
        userId: parseInt(entry.userId, 10),
        username: userHash.username || `user_${entry.userId}`,
        college: userHash.college || '',
        score: entry.score,
        solved: parseInt(userHash.solved || '0', 10),
        rating: parseInt(userHash.rating || '1200', 10)
      };
    });

    const responsePayload = {
      total: totalParticipants,
      limit: parsedLimit,
      offset: parsedOffset,
      contestId: contestId || null,
      leaderboard
    };

    // Cache top 100 for 5 seconds (SET cache:lb:top100 <json> EX 5)
    if (isTop100Global) {
      // Redis command: SET cache:lb:top100 <json> EX 5
      await redis.set('cache:lb:top100', JSON.stringify(responsePayload), 'EX', 5);
    }

    return res.status(200).json(responsePayload);
  } catch (err) {
    console.error('[Leaderboard Error]', err);
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: err.message }
    });
  }
});

/**
 * GET /leaderboard/me
 * Authenticated endpoint: Returns current user's rank, score, and surrounding competitors (2 above, 2 below)
 *
 * Demonstrates:
 *   - ZREVRANK lb:global <userId> (O(log(N)) rank calculation)
 *   - ZSCORE lb:global <userId> (O(1) score lookup)
 *   - ZREVRANGE lb:global (rank-2) (rank+2) WITHSCORES (contextual snippet)
 */
router.get('/me', requireAuth, async (req, res) => {
  try {
    const userId = req.user.userId.toString();

    // Query user's 0-based rank from the Sorted Set
    // Redis command: ZREVRANK lb:global <userId>
    const rankIndex = await redis.zrevrank('lb:global', userId);

    // Query user's current score
    // Redis command: ZSCORE lb:global <userId>
    const scoreStr = await redis.zscore('lb:global', userId);

    if (rankIndex === null || rankIndex === undefined) {
      return res.status(200).json({
        myRank: null,
        myScore: 0,
        message: 'You have not solved any problems yet. Complete a problem to appear on the leaderboard!',
        context: []
      });
    }

    const currentRank = rankIndex + 1; // Convert 0-indexed to 1-indexed
    const currentScore = parseInt(scoreStr || '0', 10);

    // Fetch 2 competitors above and 2 below
    const start = Math.max(0, rankIndex - 2);
    const stop = rankIndex + 2;

    // Redis command: ZREVRANGE lb:global <start> <stop> WITHSCORES
    const surrounding = await redis.zrevrange('lb:global', start, stop, 'WITHSCORES');

    const entries = [];
    const pipeline = redis.pipeline();

    for (let i = 0; i < surrounding.length; i += 2) {
      const mId = surrounding[i];
      const mScore = parseInt(surrounding[i + 1], 10);
      entries.push({ userId: mId, score: mScore });
      pipeline.hgetall(`user:${mId}`);
    }

    const profiles = await pipeline.exec();

    const context = entries.map((entry, idx) => {
      const entryRank = start + idx + 1;
      const userHash = profiles[idx] ? profiles[idx][1] : {};

      return {
        rank: entryRank,
        userId: parseInt(entry.userId, 10),
        username: userHash.username || `user_${entry.userId}`,
        college: userHash.college || '',
        score: entry.score,
        solved: parseInt(userHash.solved || '0', 10),
        isCurrent: entry.userId === userId
      };
    });

    return res.status(200).json({
      myRank: currentRank,
      myScore: currentScore,
      context
    });
  } catch (err) {
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: err.message }
    });
  }
});

/**
 * GET /leaderboard/colleges
 * Inter-university aggregate leaderboard from Sorted Set lb:college
 */
router.get('/colleges', async (req, res) => {
  try {
    // Redis command: ZREVRANGE lb:college 0 9 WITHSCORES
    const results = await redis.zrevrange('lb:college', 0, 9, 'WITHSCORES');
    const colleges = [];

    for (let i = 0; i < results.length; i += 2) {
      colleges.push({
        rank: (i / 2) + 1,
        college: results[i],
        score: parseInt(results[i + 1], 10)
      });
    }

    return res.status(200).json({ colleges });
  } catch (err) {
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: err.message }
    });
  }
});

/**
 * GET /leaderboard/contests
 * Lists contests and their active status
 */
router.get('/contests', async (req, res) => {
  try {
    // Redis command: SMEMBERS all:contests
    const contestIds = await redis.smembers('all:contests');
    const pipeline = redis.pipeline();

    for (const id of contestIds) {
      // Redis command: HGETALL contest:<id>
      pipeline.hgetall(`contest:${id}`);
      // Redis command: EXISTS contest:<id>:active
      pipeline.exists(`contest:${id}:active`);
    }

    const results = await pipeline.exec();
    const contests = [];

    for (let i = 0; i < contestIds.length; i++) {
      const contestData = results[i * 2] ? results[i * 2][1] : {};
      const isActive = results[i * 2 + 1] ? results[i * 2 + 1][1] === 1 : false;

      if (contestData.id) {
        contests.push({
          id: parseInt(contestData.id, 10),
          name: contestData.name,
          description: contestData.description,
          startTime: contestData.startTime,
          endTime: contestData.endTime,
          isActive
        });
      }
    }

    return res.status(200).json({ contests });
  } catch (err) {
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: err.message }
    });
  }
});

export default router;
