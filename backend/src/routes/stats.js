import express from 'express';
import { redis } from '../redis.js';

const router = express.Router();

/**
 * GET /stats/streak/:userId
 * Evaluates user coding activity streak using Redis Bitmaps
 *
 * Demonstrates:
 *   - BITCOUNT streak:<userId>:<year> (Total active days in year)
 *   - GETBIT streak:<userId>:<year> <dayOfYear> (Day-by-day active status check)
 */
router.get('/streak/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const year = new Date().getFullYear();
    const key = `streak:${userId}:${year}`;

    // Total active days in the year
    // Redis command: BITCOUNT key
    const totalActiveDays = await redis.bitcount(key);

    const now = new Date();
    const startOfYear = new Date(year, 0, 0);
    const dayOfYear = Math.floor((now - startOfYear) / 86400000);

    // Calculate current consecutive streak backwards from today
    let currentStreak = 0;
    const daysHistory = [];

    // Check last 30 days of activity
    const pipeline = redis.pipeline();
    const windowStart = Math.max(1, dayOfYear - 29);

    for (let day = windowStart; day <= dayOfYear; day++) {
      // Redis command: GETBIT key offset
      pipeline.getbit(key, day);
    }

    const bitResults = await pipeline.exec();

    for (let i = 0; i < bitResults.length; i++) {
      const day = windowStart + i;
      const isActive = bitResults[i] ? bitResults[i][1] === 1 : false;
      daysHistory.push({ day, active: isActive });
    }

    // Consecutive streak ending today or yesterday
    for (let i = daysHistory.length - 1; i >= 0; i--) {
      if (daysHistory[i].active) {
        currentStreak++;
      } else {
        // If today is not active yet, allow yesterday's streak to continue
        if (i === daysHistory.length - 1) {
          continue;
        }
        break;
      }
    }

    return res.status(200).json({
      userId: parseInt(userId, 10),
      year,
      totalActiveDays,
      currentStreak,
      recentActivity: daysHistory
    });
  } catch (err) {
    console.error('[Streak Error]', err);
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: err.message }
    });
  }
});

/**
 * GET /stats
 * Platform-wide analytics using HyperLogLog cardinality estimation
 *
 * Demonstrates:
 *   - PFCOUNT visitors:<date> (Fast O(1) memory unique visitor counter)
 *   - PFMERGE visitors:temp visitors:<date1> visitors:<date2> ... (HyperLogLog union)
 */
router.get('/', async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);

    // Redis command: PFCOUNT visitors:YYYY-MM-DD
    const todayVisitors = await redis.pfcount(`visitors:${today}`);

    // Aggregate weekly visitors across past 7 days using PFMERGE
    const past7DaysKeys = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      past7DaysKeys.push(`visitors:${dateStr}`);
    }

    const tempMergedKey = `temp:visitors:weekly:${Date.now()}`;
    // Redis command: PFMERGE destKey sourceKey1 sourceKey2 ...
    await redis.pfmerge(tempMergedKey, ...past7DaysKeys);
    // Redis command: PFCOUNT destKey
    const weeklyVisitors = await redis.pfcount(tempMergedKey);
    // Clean up temporary aggregated key
    await redis.del(tempMergedKey);

    // Leaderboard counts
    const totalUsers = await redis.zcard('lb:global');
    const totalProblems = await redis.scard('all:problems');
    const totalSubmissions = parseInt((await redis.get('submission:id_seq')) || '0', 10);

    return res.status(200).json({
      metrics: {
        todayVisitors,
        weeklyVisitors,
        totalUsers,
        totalProblems,
        totalSubmissions
      }
    });
  } catch (err) {
    console.error('[Stats Error]', err);
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: err.message }
    });
  }
});

export default router;
