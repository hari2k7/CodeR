import express from 'express';
import { redis } from '../redis.js';
import { requireAuth } from '../middleware/session.js';

const router = express.Router();

/**
 * Optional auth middleware for endpoints that can be personalized if authenticated
 */
async function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const session = await redis.hgetall(`session:${token}`);
      if (session && session.userId) {
        req.user = session;
      }
    }
  } catch (err) {}
  next();
}

/**
 * POST /submissions
 * Queues a new code submission into Redis Stream and creates tracking Hash
 *
 * Demonstrates:
 *   - INCR submission:id_seq (atomic sequence)
 *   - HSET submission:<id> (hash storage)
 *   - LPUSH / LTRIM user:<id>:history (capped list of user activity)
 *   - XADD submissions * ... (Redis Stream event ingestion)
 */
router.post('/', requireAuth, async (req, res) => {
  try {
    const { problemId, code, language = 'cpp', contestId } = req.body;

    if (!problemId) {
      return res.status(400).json({
        error: { code: 'BAD_REQUEST', message: 'problemId is required.' }
      });
    }

    if (!code || code.trim().length === 0) {
      return res.status(400).json({
        error: { code: 'BAD_REQUEST', message: 'Code cannot be empty.' }
      });
    }

    // Verify problem exists
    // Redis command: HGETALL problem:<id>
    const problem = await redis.hgetall(`problem:${problemId}`);
    if (!problem || !problem.id) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: `Problem with ID ${problemId} does not exist.` }
      });
    }

    // Atomic submission sequence counter
    // Redis command: INCR submission:id_seq
    const subId = await redis.incr('submission:id_seq');

    const submittedAt = Date.now().toString();

    // Store submission record as a Redis Hash
    // Redis command: HSET submission:<id> ...
    await redis.hset(`submission:${subId}`, {
      id: subId.toString(),
      userId: req.user.userId.toString(),
      username: req.user.username,
      problemId: problemId.toString(),
      problemTitle: problem.title,
      code,
      language,
      status: 'PENDING',
      verdict: 'QUEUED',
      points: '0',
      contestId: contestId ? contestId.toString() : '',
      submittedAt
    });

    // Add submission to user's recent history List (capped to 50 items)
    // Redis command: LPUSH user:<userId>:history <subId>
    await redis.lpush(`user:${req.user.userId}:history`, subId.toString());
    // Redis command: LTRIM user:<userId>:history 0 49
    await redis.ltrim(`user:${req.user.userId}:history`, 0, 49);

    // Append submission job into Redis Stream
    // Redis command: XADD submissions * field value ...
    const streamId = await redis.xadd(
      'submissions',
      '*',
      'submissionId', subId.toString(),
      'problemId', problemId.toString(),
      'userId', req.user.userId.toString(),
      'username', req.user.username,
      'language', language,
      'contestId', contestId ? contestId.toString() : ''
    );

    return res.status(201).json({
      success: true,
      submissionId: subId,
      streamId,
      status: 'PENDING',
      verdict: 'QUEUED',
      problemTitle: problem.title,
      submittedAt
    });
  } catch (err) {
    console.error('[Submission Enqueue Error]', err);
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: err.message }
    });
  }
});

/**
 * GET /submissions/:id
 * Polls the current verdict/status of a submission
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    // Redis command: HGETALL submission:<id>
    const sub = await redis.hgetall(`submission:${id}`);

    if (!sub || !sub.id) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: `Submission with ID ${id} not found.` }
      });
    }

    return res.status(200).json({
      submission: {
        id: parseInt(sub.id, 10),
        userId: parseInt(sub.userId, 10),
        username: sub.username,
        problemId: parseInt(sub.problemId, 10),
        problemTitle: sub.problemTitle,
        language: sub.language,
        status: sub.status,
        verdict: sub.verdict,
        points: parseInt(sub.points || '0', 10),
        executionTime: sub.executionTime ? parseInt(sub.executionTime, 10) : null,
        memory: sub.memory ? parseInt(sub.memory, 10) : null,
        code: sub.code,
        submittedAt: sub.submittedAt,
        judgedAt: sub.judgedAt || null
      }
    });
  } catch (err) {
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: err.message }
    });
  }
});

/**
 * GET /submissions
 * Lists recent submissions (filtered by user or global latest)
 */
router.get('/', optionalAuth, async (req, res) => {
  try {
    const { userId, limit = 20, offset = 0 } = req.query;
    const parsedLimit = Math.max(1, Math.min(50, parseInt(limit, 10) || 20));
    const parsedOffset = Math.max(0, parseInt(offset, 10) || 0);

    const targetUserId = userId || (req.user ? req.user.userId : null);

    let submissionIds = [];

    if (targetUserId) {
      // Fetch recent submission IDs from user history list
      // Redis command: LRANGE user:<userId>:history offset (offset + limit - 1)
      submissionIds = await redis.lrange(
        `user:${targetUserId}:history`,
        parsedOffset,
        parsedOffset + parsedLimit - 1
      );
    } else {
      // Fallback: Global recent submissions derived from sequence counter
      const maxSeq = parseInt((await redis.get('submission:id_seq')) || '0', 10);
      const startId = Math.max(1, maxSeq - parsedOffset);
      const endId = Math.max(1, startId - parsedLimit + 1);
      for (let i = startId; i >= endId; i--) {
        submissionIds.push(i.toString());
      }
    }

    if (submissionIds.length === 0) {
      return res.status(200).json({ submissions: [] });
    }

    // Hydrate submission hashes via pipeline
    const pipeline = redis.pipeline();
    for (const id of submissionIds) {
      // Redis command: HGETALL submission:<id>
      pipeline.hgetall(`submission:${id}`);
    }

    const results = await pipeline.exec();
    const submissions = [];

    for (const item of results) {
      const sub = item[1];
      if (sub && sub.id) {
        submissions.push({
          id: parseInt(sub.id, 10),
          userId: parseInt(sub.userId, 10),
          username: sub.username,
          problemId: parseInt(sub.problemId, 10),
          problemTitle: sub.problemTitle,
          language: sub.language,
          status: sub.status,
          verdict: sub.verdict,
          points: parseInt(sub.points || '0', 10),
          executionTime: sub.executionTime ? parseInt(sub.executionTime, 10) : null,
          memory: sub.memory ? parseInt(sub.memory, 10) : null,
          submittedAt: sub.submittedAt,
          judgedAt: sub.judgedAt || null
        });
      }
    }

    return res.status(200).json({
      total: submissions.length,
      limit: parsedLimit,
      offset: parsedOffset,
      submissions
    });
  } catch (err) {
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: err.message }
    });
  }
});

export default router;
