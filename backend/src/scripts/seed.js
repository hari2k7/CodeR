import bcrypt from 'bcrypt';
import { redis } from '../redis.js';

// Predefined colleges for university DBMS case study
const COLLEGES = [
  'MIT', 'Stanford', 'UC Berkeley', 'Carnegie Mellon', 'Harvard',
  'IIT Bombay', 'Oxford', 'Cambridge', 'Tsinghua', 'ETH Zurich'
];

// 50 canonical competitive programming problems with varied tags and difficulties
const PROBLEMS_CATALOG = [
  { id: 1, title: 'Two Sum', difficulty: 'easy', points: 100, tags: ['arrays', 'data-structures'] },
  { id: 2, title: 'Valid Parentheses', difficulty: 'easy', points: 100, tags: ['strings', 'data-structures'] },
  { id: 3, title: 'Longest Substring Without Repeating Characters', difficulty: 'medium', points: 200, tags: ['strings', 'arrays'] },
  { id: 4, title: 'Median of Two Sorted Arrays', difficulty: 'hard', points: 300, tags: ['binary-search', 'arrays'] },
  { id: 5, title: 'Longest Palindromic Substring', difficulty: 'medium', points: 200, tags: ['dp', 'strings'] },
  { id: 6, title: 'Container With Most Water', difficulty: 'medium', points: 200, tags: ['arrays', 'greedy'] },
  { id: 7, title: '3Sum', difficulty: 'medium', points: 200, tags: ['arrays', 'binary-search'] },
  { id: 8, title: 'Merge k Sorted Lists', difficulty: 'hard', points: 300, tags: ['data-structures', 'recursion'] },
  { id: 9, title: 'Trapping Rain Water', difficulty: 'hard', points: 300, tags: ['arrays', 'dp'] },
  { id: 10, title: 'Rotate Image', difficulty: 'medium', points: 200, tags: ['math', 'arrays'] },
  { id: 11, title: 'Group Anagrams', difficulty: 'medium', points: 200, tags: ['strings', 'data-structures'] },
  { id: 12, title: 'Maximum Subarray', difficulty: 'easy', points: 100, tags: ['arrays', 'dp'] },
  { id: 13, title: 'Spiral Matrix', difficulty: 'medium', points: 200, tags: ['arrays', 'geometry'] },
  { id: 14, title: 'Jump Game', difficulty: 'medium', points: 200, tags: ['greedy', 'dp'] },
  { id: 15, title: 'Merge Intervals', difficulty: 'medium', points: 200, tags: ['arrays', 'greedy'] },
  { id: 16, title: 'Unique Paths', difficulty: 'medium', points: 200, tags: ['dp', 'math'] },
  { id: 17, title: 'Minimum Path Sum', difficulty: 'medium', points: 200, tags: ['dp', 'arrays'] },
  { id: 18, title: 'Climbing Stairs', difficulty: 'easy', points: 100, tags: ['dp', 'math'] },
  { id: 19, title: 'Edit Distance', difficulty: 'hard', points: 300, tags: ['dp', 'strings'] },
  { id: 20, title: 'Subsets', difficulty: 'medium', points: 200, tags: ['recursion', 'bit-manipulation'] },
  { id: 21, title: 'Word Search', difficulty: 'medium', points: 200, tags: ['graphs', 'recursion'] },
  { id: 22, title: 'Largest Rectangle in Histogram', difficulty: 'hard', points: 300, tags: ['data-structures', 'arrays'] },
  { id: 23, title: 'Binary Tree Inorder Traversal', difficulty: 'easy', points: 100, tags: ['trees', 'recursion'] },
  { id: 24, title: 'Validate Binary Search Tree', difficulty: 'medium', points: 200, tags: ['trees', 'recursion'] },
  { id: 25, title: 'Symmetric Tree', difficulty: 'easy', points: 100, tags: ['trees', 'recursion'] },
  { id: 26, title: 'Binary Tree Level Order Traversal', difficulty: 'medium', points: 200, tags: ['trees', 'graphs'] },
  { id: 27, title: 'Maximum Depth of Binary Tree', difficulty: 'easy', points: 100, tags: ['trees', 'recursion'] },
  { id: 28, title: 'Construct Tree from Preorder & Inorder', difficulty: 'medium', points: 200, tags: ['trees', 'arrays'] },
  { id: 29, title: 'Best Time to Buy and Sell Stock', difficulty: 'easy', points: 100, tags: ['arrays', 'dp'] },
  { id: 30, title: 'Binary Tree Maximum Path Sum', difficulty: 'hard', points: 300, tags: ['trees', 'dp'] },
  { id: 31, title: 'Valid Palindrome', difficulty: 'easy', points: 100, tags: ['strings', 'arrays'] },
  { id: 32, title: 'Word Break', difficulty: 'medium', points: 200, tags: ['dp', 'strings'] },
  { id: 33, title: 'Linked List Cycle', difficulty: 'easy', points: 100, tags: ['data-structures', 'arrays'] },
  { id: 34, title: 'LRU Cache Design', difficulty: 'medium', points: 200, tags: ['data-structures'] },
  { id: 35, title: 'Min Stack Design', difficulty: 'easy', points: 100, tags: ['data-structures'] },
  { id: 36, title: 'Number of Islands', difficulty: 'medium', points: 200, tags: ['graphs', 'recursion'] },
  { id: 37, title: 'Reverse Linked List', difficulty: 'easy', points: 100, tags: ['data-structures'] },
  { id: 38, title: 'Course Schedule', difficulty: 'medium', points: 200, tags: ['graphs'] },
  { id: 39, title: 'Implement Trie Prefix Tree', difficulty: 'medium', points: 200, tags: ['trees', 'strings'] },
  { id: 40, title: 'Kth Largest Element in an Array', difficulty: 'medium', points: 200, tags: ['data-structures', 'arrays'] },
  { id: 41, title: 'Invert Binary Tree', difficulty: 'easy', points: 100, tags: ['trees', 'recursion'] },
  { id: 42, title: 'Lowest Common Ancestor in BST', difficulty: 'easy', points: 100, tags: ['trees', 'math'] },
  { id: 43, title: 'Product of Array Except Self', difficulty: 'medium', points: 200, tags: ['arrays', 'math'] },
  { id: 44, title: 'Search a 2D Matrix', difficulty: 'medium', points: 200, tags: ['binary-search', 'arrays'] },
  { id: 45, title: 'Sliding Window Maximum', difficulty: 'hard', points: 300, tags: ['data-structures', 'arrays'] },
  { id: 46, title: 'Coin Change', difficulty: 'medium', points: 200, tags: ['dp', 'math'] },
  { id: 47, title: 'Longest Increasing Subsequence', difficulty: 'medium', points: 200, tags: ['dp', 'binary-search'] },
  { id: 48, title: 'Counting Bits', difficulty: 'easy', points: 100, tags: ['bit-manipulation', 'dp'] },
  { id: 49, title: 'Top K Frequent Elements', difficulty: 'medium', points: 200, tags: ['data-structures', 'math'] },
  { id: 50, title: 'Alien Dictionary Topological Sort', difficulty: 'hard', points: 300, tags: ['graphs', 'strings'] }
];

// Top featured demo users
const FEATURED_USERS = [
  { username: 'alex_code', college: 'MIT', rating: 2450 },
  { username: 'bob_dev', college: 'Stanford', rating: 2310 },
  { username: 'carol_algo', college: 'UC Berkeley', rating: 2280 },
  { username: 'dave_ops', college: 'Carnegie Mellon', rating: 2150 },
  { username: 'elena_cp', college: 'IIT Bombay', rating: 2090 },
  { username: 'frank_sys', college: 'ETH Zurich', rating: 1980 },
  { username: 'grace_hopper', college: 'Harvard', rating: 1920 },
  { username: 'hector_graph', college: 'Oxford', rating: 1850 },
  { username: 'iris_tree', college: 'Cambridge', rating: 1780 },
  { username: 'jack_dp', college: 'Tsinghua', rating: 1720 }
];

/**
 * Safe key scanning and deletion by prefix using SCAN (NEVER FLUSHALL / FLUSHDB)
 */
async function scanAndDeletePrefix(prefix) {
  let cursor = '0';
  let deletedCount = 0;
  do {
    // Redis command: SCAN cursor MATCH pattern COUNT 200
    const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', prefix, 'COUNT', 200);
    cursor = nextCursor;
    if (keys.length > 0) {
      // Redis command: DEL key1 key2 ...
      await redis.del(...keys);
      deletedCount += keys.length;
    }
  } while (cursor !== '0');
  return deletedCount;
}

/**
 * Execute Reset when --reset flag is present
 */
async function resetAppData() {
  console.log('[Seed] Starting idempotent safe cleanup using SCAN...');
  const prefixes = [
    'user:*', 'problem:*', 'submission:*', 'contest:*', 'tag:*',
    'difficulty:*', 'all:*', 'solved:*', 'lb:*', 'cache:*',
    'streak:*', 'visitors:*', 'pending:*', 'otp:*', 'rl:*',
    'session:*', 'submissions', 'usernames', 'bf:usernames'
  ];

  let totalDeleted = 0;
  for (const p of prefixes) {
    const deleted = await scanAndDeletePrefix(p);
    totalDeleted += deleted;
  }
  console.log(`[Seed] Safe reset completed: ${totalDeleted} app keys purged.`);
}

/**
 * Main seed function
 */
async function seed() {
  const isReset = process.argv.includes('--reset');
  if (isReset) {
    await resetAppData();
  }

  console.log('[Seed] Starting CodeRank data seeding...');

  // 1. Password hash computation (single hash to speed up 100+ user insertions)
  const defaultPassword = 'Test@1234';
  const passwordHash = await bcrypt.hash(defaultPassword, 10);

  // 2. Seed 120 Users
  console.log('[Seed] Creating 120 demo users...');
  const userPipeline = redis.pipeline();

  const totalUsers = 120;
  const userObjects = [];

  for (let i = 1; i <= totalUsers; i++) {
    let username = `user_${i}`;
    let college = COLLEGES[i % COLLEGES.length];
    let rating = 1200 + ((i * 17) % 700);

    if (i <= FEATURED_USERS.length) {
      username = FEATURED_USERS[i - 1].username;
      college = FEATURED_USERS[i - 1].college;
      rating = FEATURED_USERS[i - 1].rating;
    }

    const email = `${username}@code.edu`;
    userObjects.push({ id: i, username, email, college, rating });

    // Redis command: HSET user:<id> ...
    userPipeline.hset(`user:${i}`, {
      id: i.toString(),
      username,
      email,
      passwordHash,
      rating: rating.toString(),
      solved: '0',
      college,
      createdAt: (Date.now() - 86400000 * 30 + i * 3600000).toString()
    });

    // Redis command: SETNX user:name:<username> <id>
    userPipeline.set(`user:name:${username}`, i.toString());
    // Redis command: SETNX user:email:<email> <id>
    userPipeline.set(`user:email:${email}`, i.toString());
    // Redis command: SADD usernames <username>
    userPipeline.sadd('usernames', username);
  }

  userPipeline.set('user:id_seq', totalUsers.toString());
  await userPipeline.exec();

  // Seed Bloom filter if module is active
  try {
    const bloomPipeline = redis.pipeline();
    for (const u of userObjects) {
      bloomPipeline.call('BF.ADD', 'bf:usernames', u.username);
    }
    await bloomPipeline.exec();
    console.log('[Seed] Added usernames to RedisBloom filter bf:usernames');
  } catch (err) {
    // Bloom not loaded or optional
  }

  // 3. Seed 50 Problems
  console.log('[Seed] Creating 50 competitive programming problems...');
  const probPipeline = redis.pipeline();

  for (const prob of PROBLEMS_CATALOG) {
    const statement = `Given standard competitive programming input, solve '${prob.title}' optimally. Ensure time limit and memory limits are respected.`;
    // Redis command: HSET problem:<id> ...
    probPipeline.hset(`problem:${prob.id}`, {
      id: prob.id.toString(),
      title: prob.title,
      statement,
      difficulty: prob.difficulty,
      points: prob.points.toString(),
      tags: JSON.stringify(prob.tags),
      timeLimit: prob.difficulty === 'hard' ? '2000' : '1000',
      memoryLimit: '256',
      createdAt: (Date.now() - 86400000 * 45 + prob.id * 7200000).toString()
    });

    // Redis command: SADD all:problems <id>
    probPipeline.sadd('all:problems', prob.id.toString());
    // Redis command: SADD difficulty:<level> <id>
    probPipeline.sadd(`difficulty:${prob.difficulty}`, prob.id.toString());

    // Redis command: SADD tag:<name> <id>
    for (const t of prob.tags) {
      probPipeline.sadd(`tag:${t}`, prob.id.toString());
    }
  }

  probPipeline.set('problem:id_seq', PROBLEMS_CATALOG.length.toString());
  await probPipeline.exec();

  // 4. Seed Contest
  console.log('[Seed] Creating featured contest...');
  const contestPipeline = redis.pipeline();
  const contestId = 1;
  const contestStart = Date.now() - 3600000 * 24; // Started 1 day ago
  const contestEnd = Date.now() + 3600000 * 24 * 6; // Ends in 6 days

  // Redis command: HSET contest:<id> ...
  contestPipeline.hset(`contest:${contestId}`, {
    id: contestId.toString(),
    name: 'CodeRank Fall Grand Prix 2026',
    description: 'Annual inter-university competitive programming championship.',
    startTime: contestStart.toString(),
    endTime: contestEnd.toString(),
    status: 'ACTIVE'
  });
  contestPipeline.sadd('all:contests', contestId.toString());
  contestPipeline.set('contest:id_seq', contestId.toString());

  // Redis command: SET contest:1:active 1 EXPIREAT <timestamp>
  contestPipeline.set(`contest:${contestId}:active`, '1', 'EXAT', Math.floor(contestEnd / 1000));
  await contestPipeline.exec();

  // 5. Seed 1200+ Submissions & Populate Leaderboards
  console.log('[Seed] Simulating 1200+ historical submissions and leaderboards...');
  const subPipeline = redis.pipeline();
  let submissionIdSeq = 0;

  const languages = ['cpp', 'python', 'java', 'rust'];

  for (const user of userObjects) {
    // Solves distribution based on rating tier
    let solvesCount = 3;
    if (user.id <= 5) solvesCount = 35; // Top 5
    else if (user.id <= 15) solvesCount = 24;
    else if (user.id <= 40) solvesCount = 14;
    else if (user.id <= 80) solvesCount = 6;

    // Pick problems to solve
    const solvedProbIds = [];
    for (let p = 1; p <= solvesCount; p++) {
      const probIndex = ((user.id * 7 + p * 13) % PROBLEMS_CATALOG.length);
      const prob = PROBLEMS_CATALOG[probIndex];
      if (!solvedProbIds.includes(prob.id)) {
        solvedProbIds.push(prob.id);
      }
    }

    let userTotalScore = 0;

    for (const probId of solvedProbIds) {
      const prob = PROBLEMS_CATALOG.find((p) => p.id === probId);
      const points = prob.points;
      userTotalScore += points;

      submissionIdSeq++;
      const subId = submissionIdSeq;

      // Redis command: SADD solved:<userId> <problemId>
      subPipeline.sadd(`solved:${user.id}`, probId.toString());

      // Create AC submission hash
      // Redis command: HSET submission:<id> ...
      subPipeline.hset(`submission:${subId}`, {
        id: subId.toString(),
        userId: user.id.toString(),
        username: user.username,
        problemId: probId.toString(),
        problemTitle: prob.title,
        language: languages[subId % languages.length],
        status: 'COMPLETED',
        verdict: 'AC',
        points: points.toString(),
        executionTime: (20 + (subId % 180)).toString(),
        memory: (12 + (subId % 28)).toString(),
        submittedAt: (Date.now() - (1200 - subId) * 120000).toString()
      });

      // Redis command: LPUSH user:<id>:history <subId>
      subPipeline.lpush(`user:${user.id}:history`, subId.toString());

      // Increment college leaderboard
      // Redis command: ZINCRBY lb:college <points> <college>
      subPipeline.zincrby('lb:college', points, user.college);

      // Increment contest leaderboard
      // Redis command: ZINCRBY lb:contest:1 <points> <userId>
      subPipeline.zincrby(`lb:contest:${contestId}`, points, user.id.toString());
    }

    // Redis command: ZADD lb:global <score> <userId>
    // Sorted Set for real-time global leaderboard
    subPipeline.zadd('lb:global', userTotalScore, user.id.toString());

    // Update user profile solved counter
    subPipeline.hset(`user:${user.id}`, 'solved', solvedProbIds.length.toString());

    // Trim submission history list to 50 items
    // Redis command: LTRIM user:<id>:history 0 49
    subPipeline.ltrim(`user:${user.id}:history`, 0, 49);

    // Also inject some WA and TLE submissions for realistic history
    for (let w = 0; w < 2; w++) {
      submissionIdSeq++;
      const subId = submissionIdSeq;
      const verdict = w === 0 ? 'WA' : 'TLE';
      const prob = PROBLEMS_CATALOG[(user.id + w) % PROBLEMS_CATALOG.length];
      subPipeline.hset(`submission:${subId}`, {
        id: subId.toString(),
        userId: user.id.toString(),
        username: user.username,
        problemId: prob.id.toString(),
        problemTitle: prob.title,
        language: languages[subId % languages.length],
        status: 'COMPLETED',
        verdict,
        points: '0',
        executionTime: verdict === 'TLE' ? '2050' : '45',
        memory: '30',
        submittedAt: (Date.now() - (1500 - subId) * 90000).toString()
      });
      subPipeline.lpush(`user:${user.id}:history`, subId.toString());
      subPipeline.ltrim(`user:${user.id}:history`, 0, 49);
    }
  }

  subPipeline.set('submission:id_seq', submissionIdSeq.toString());
  await subPipeline.exec();

  // 6. Seed Bitmaps for Activity Streaks
  console.log('[Seed] Seeding daily coding streak bitmaps (SETBIT)...');
  const streakPipeline = redis.pipeline();
  const year = 2026;
  const currentDayOfYear = 299;

  for (let u = 1; u <= 30; u++) {
    // Top 30 users have consecutive active days
    const streakLength = (u <= 10) ? 14 : 7;
    for (let day = currentDayOfYear - streakLength; day <= currentDayOfYear; day++) {
      // Redis command: SETBIT streak:<userId>:<year> <dayOfYear> 1
      streakPipeline.setbit(`streak:${u}:${year}`, day, 1);
    }
  }
  await streakPipeline.exec();

  // 7. Seed HyperLogLog Unique Visitors
  console.log('[Seed] Seeding HyperLogLog unique daily visitors (PFADD)...');
  const today = new Date().toISOString().slice(0, 10);
  const hllPipeline = redis.pipeline();
  for (let v = 1; v <= 450; v++) {
    const fakeIp = `192.168.${(v % 254) + 1}.${Math.floor(v / 254) + 1}`;
    // Redis command: PFADD visitors:YYYY-MM-DD <ip>
    hllPipeline.pfadd(`visitors:${today}`, fakeIp);
  }
  await hllPipeline.exec();

  console.log('\n' + '='.repeat(60));
  console.log(' [CODERANK SEED COMPLETE]');
  console.log(` Users Created:        ${totalUsers}`);
  console.log(` Problems Seeded:      ${PROBLEMS_CATALOG.length}`);
  console.log(` Submissions Seeded:   ${submissionIdSeq}`);
  console.log(` Contests Active:      1 ("CodeRank Fall Grand Prix 2026")`);
  console.log(' Leaderboard:          Populated (lb:global, lb:college, lb:contest:1)');
  console.log(' Bitmaps & HLL:        Active');
  console.log('-'.repeat(60));
  console.log(' DEMO CREDENTIALS:');
  console.log(' Known Password:       Test@1234');
  console.log(' Featured Users:');
  for (const u of FEATURED_USERS.slice(0, 5)) {
    console.log(`   - Username: ${u.username.padEnd(14)} College: ${u.college.padEnd(16)} Rating: ${u.rating}`);
  }
  console.log('='.repeat(60) + '\n');

  process.exit(0);
}

seed().catch((err) => {
  console.error('[Seed Error]', err);
  process.exit(1);
});
