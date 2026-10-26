import express from 'express';
import { redis } from '../redis.js';

const router = express.Router();

/**
 * Optional session inspector middleware to detect logged in user if Bearer token is provided
 * Does not reject unauthenticated users; just attaches req.user if valid.
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
  } catch (err) {
    // Ignore error and proceed as anonymous
  }
  next();
}

/**
 * GET /problems
 * Query params:
 *   - tags: comma-separated list of tags (e.g., 'dp,graph')
 *   - difficulty: 'easy', 'medium', or 'hard'
 *   - mode: 'all' (default, SINTER intersection) or 'any' (SUNION union)
 *   - limit: integer (default 20)
 *   - offset: integer (default 0)
 *
 * Demonstrates Redis Set operations:
 *   - SINTER: Computes set intersection natively inside Redis
 *   - SUNION: Computes set union natively inside Redis
 *   - SMEMBERS: Retrieves entire member set
 *   - Pipeline HGETALL: Fetches multiple problem hashes in a single network round-trip
 */
router.get('/', optionalAuth, async (req, res) => {
  try {
    const { tags, difficulty, mode = 'all', limit = 20, offset = 0 } = req.query;
    const parsedLimit = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
    const parsedOffset = Math.max(0, parseInt(offset, 10) || 0);

    const tagList = tags
      ? tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)
      : [];

    let matchingIds = [];

    // Case 1: Filter by tags and/or difficulty
    if (tagList.length > 0 || difficulty) {
      const keysToIntersect = [];

      if (difficulty) {
        // Redis Set key for difficulty: difficulty:easy | difficulty:medium | difficulty:hard
        keysToIntersect.push(`difficulty:${difficulty.toLowerCase().trim()}`);
      }

      if (tagList.length > 0) {
        if (mode === 'any') {
          // Mode 'any': Problems having AT LEAST ONE of the specified tags (SUNION)
          const tagKeys = tagList.map((t) => `tag:${t}`);
          // Redis command: SUNION tag:t1 tag:t2 ...
          const unionIds = await redis.sunion(...tagKeys);

          if (difficulty) {
            // Intersect union result with difficulty set
            // Redis command: SMEMBERS difficulty:<level>
            const diffIds = await redis.smembers(`difficulty:${difficulty.toLowerCase().trim()}`);
            const diffSet = new Set(diffIds);
            matchingIds = unionIds.filter((id) => diffSet.has(id));
          } else {
            matchingIds = unionIds;
          }
        } else {
          // Mode 'all' (default): Problems having ALL specified tags (SINTER)
          for (const t of tagList) {
            keysToIntersect.push(`tag:${t}`);
          }
          // Redis command: SINTER key1 key2 ...
          // Performs atomic server-side set intersection
          matchingIds = await redis.sinter(...keysToIntersect);
        }
      } else {
        // Only difficulty filter
        matchingIds = await redis.smembers(keysToIntersect[0]);
      }
    } else {
      // Case 2: No filters -> Retrieve all problem IDs
      // Redis command: SMEMBERS all:problems
      matchingIds = await redis.smembers('all:problems');
    }

    // Sort IDs numerically for consistent listing
    const sortedIds = matchingIds
      .map((id) => parseInt(id, 10))
      .sort((a, b) => a - b);

    const total = sortedIds.length;
    const pageIds = sortedIds.slice(parsedOffset, parsedOffset + parsedLimit);

    if (pageIds.length === 0) {
      return res.status(200).json({
        total,
        limit: parsedLimit,
        offset: parsedOffset,
        problems: []
      });
    }

    // Use Redis Pipeline to fetch all problem hashes in ONE round trip
    const pipeline = redis.pipeline();
    for (const id of pageIds) {
      // Redis command: HGETALL problem:<id>
      pipeline.hgetall(`problem:${id}`);
      if (req.user && req.user.userId) {
        // Redis command: SISMEMBER solved:<userId> <problemId>
        pipeline.sismember(`solved:${req.user.userId}`, id);
      }
    }

    const results = await pipeline.exec();
    const problems = [];
    const step = req.user && req.user.userId ? 2 : 1;

    for (let i = 0; i < pageIds.length; i++) {
      const hashRes = results[i * step];
      const hashData = hashRes ? hashRes[1] : null;

      if (hashData && hashData.id) {
        let tagsParsed = [];
        try {
          tagsParsed = JSON.parse(hashData.tags || '[]');
        } catch {
          tagsParsed = (hashData.tags || '').split(',').filter(Boolean);
        }

        const problemItem = {
          id: parseInt(hashData.id, 10),
          title: hashData.title,
          difficulty: hashData.difficulty,
          points: parseInt(hashData.points || '100', 10),
          tags: tagsParsed,
          timeLimit: parseInt(hashData.timeLimit || '1000', 10),
          memoryLimit: parseInt(hashData.memoryLimit || '256', 10),
          createdAt: hashData.createdAt
        };

        if (req.user && req.user.userId) {
          const solvedRes = results[i * step + 1];
          problemItem.solved = solvedRes ? solvedRes[1] === 1 : false;
        }

        problems.push(problemItem);
      }
    }

    return res.status(200).json({
      total,
      limit: parsedLimit,
      offset: parsedOffset,
      problems
    });
  } catch (err) {
    console.error('[Problems List Error]', err);
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: err.message }
    });
  }
});

/**
 * GET /problems/tags
 * Returns list of all available tags with problem counts
 */
router.get('/tags', async (req, res) => {
  try {
    // Known canonical problem tags in CodeRank
    const canonicalTags = [
      'dp', 'graphs', 'trees', 'math', 'strings', 'arrays',
      'greedy', 'binary-search', 'data-structures', 'recursion',
      'bit-manipulation', 'geometry'
    ];

    const pipeline = redis.pipeline();
    for (const tag of canonicalTags) {
      // Redis command: SCARD tag:<name>
      // Returns the cardinality (count of problem IDs) of the set
      pipeline.scard(`tag:${tag}`);
    }

    const results = await pipeline.exec();
    const tagsWithCounts = canonicalTags.map((tag, idx) => ({
      name: tag,
      count: results[idx] ? results[idx][1] : 0
    })).filter((t) => t.count > 0);

    return res.status(200).json({ tags: tagsWithCounts });
  } catch (err) {
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: err.message }
    });
  }
});

/**
 * GET /problems/search?q=
 * Searches problems by keyword in title or statement
 */
router.get('/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.trim().length === 0) {
      return res.status(400).json({
        error: { code: 'BAD_REQUEST', message: 'Search query parameter q is required.' }
      });
    }

    const query = q.toLowerCase().trim();

    // Redis command: SMEMBERS all:problems
    const allProblemIds = await redis.smembers('all:problems');

    const pipeline = redis.pipeline();
    for (const id of allProblemIds) {
      // Redis command: HGETALL problem:<id>
      pipeline.hgetall(`problem:${id}`);
    }

    const results = await pipeline.exec();
    const matched = [];

    for (const resItem of results) {
      const p = resItem[1];
      if (p && p.id) {
        const titleMatch = (p.title || '').toLowerCase().includes(query);
        const statementMatch = (p.statement || '').toLowerCase().includes(query);
        const tagsMatch = (p.tags || '').toLowerCase().includes(query);

        if (titleMatch || statementMatch || tagsMatch) {
          let tagsParsed = [];
          try {
            tagsParsed = JSON.parse(p.tags || '[]');
          } catch {
            tagsParsed = (p.tags || '').split(',').filter(Boolean);
          }
          matched.push({
            id: parseInt(p.id, 10),
            title: p.title,
            difficulty: p.difficulty,
            points: parseInt(p.points || '100', 10),
            tags: tagsParsed
          });
        }
      }
    }

    return res.status(200).json({
      query: q,
      total: matched.length,
      problems: matched.slice(0, 20)
    });
  } catch (err) {
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: err.message }
    });
  }
});

/**
 * GET /problems/:id
 * Fetches single problem statement and metadata
 */
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;
    // Redis command: HGETALL problem:<id>
    const problem = await redis.hgetall(`problem:${id}`);

    if (!problem || !problem.id) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: `Problem with ID ${id} not found.` }
      });
    }

    let tags = [];
    try {
      tags = JSON.parse(problem.tags || '[]');
    } catch {
      tags = (problem.tags || '').split(',').filter(Boolean);
    }

    let solved = false;
    if (req.user && req.user.userId) {
      // Redis command: SISMEMBER solved:<userId> <problemId>
      const isSolved = await redis.sismember(`solved:${req.user.userId}`, id);
      solved = isSolved === 1;
    }

    return res.status(200).json({
      problem: {
        id: parseInt(problem.id, 10),
        title: problem.title,
        statement: problem.statement,
        difficulty: problem.difficulty,
        points: parseInt(problem.points || '100', 10),
        tags,
        timeLimit: parseInt(problem.timeLimit || '1000', 10),
        memoryLimit: parseInt(problem.memoryLimit || '256', 10),
        createdAt: problem.createdAt,
        solved
      }
    });
  } catch (err) {
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: err.message }
    });
  }
});

export default router;
