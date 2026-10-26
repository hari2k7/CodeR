import { createWorkerClient } from '../redis.js';
import { executeAtomicSolve } from '../services/scoring.js';

// Dedicated Redis connection for stream worker
const workerClient = createWorkerClient();

const STREAM_KEY = 'submissions';
const GROUP_NAME = 'judge-workers';
const CONSUMER_NAME = `judge-worker-${process.pid}`;

let isRunning = true;

/**
 * Initialize Consumer Group on Stream
 * Uses MKSTREAM to create the stream if it does not yet exist.
 * Gracefully ignores BUSYGROUP if already initialized.
 */
async function initConsumerGroup() {
  try {
    // Redis command: XGROUP CREATE submissions judge-workers $ MKSTREAM
    await workerClient.xgroup('CREATE', STREAM_KEY, GROUP_NAME, '$', 'MKSTREAM');
    console.log(`[Judge Worker] Created consumer group '${GROUP_NAME}' on stream '${STREAM_KEY}'`);
  } catch (err) {
    if (err.message.includes('BUSYGROUP')) {
      console.log(`[Judge Worker] Consumer group '${GROUP_NAME}' already registered.`);
    } else {
      console.error(`[Judge Worker] Failed to create consumer group:`, err.message);
    }
  }
}

/**
 * Helper to parse Redis Stream key-value array into a JavaScript Object
 */
function parseStreamFields(fieldsArray) {
  const obj = {};
  for (let i = 0; i < fieldsArray.length; i += 2) {
    obj[fieldsArray[i]] = fieldsArray[i + 1];
  }
  return obj;
}

/**
 * Process a single submission item
 */
async function processSubmission(messageId, fields) {
  const subId = fields.submissionId;
  const problemId = fields.problemId;
  const userId = fields.userId;
  const username = fields.username || `user_${userId}`;
  const contestId = fields.contestId || '';

  console.log(`[Judge Worker] [${messageId}] Judging Submission #${subId} (Problem #${problemId}, User #${userId})...`);

  // Step 1: Update submission Hash status to JUDGING
  // Redis command: HSET submission:<id> status JUDGING
  await workerClient.hset(`submission:${subId}`, 'status', 'JUDGING');

  // Publish status change to lb:updates Pub/Sub channel
  await workerClient.publish(
    'lb:updates',
    JSON.stringify({
      type: 'submission_status',
      submissionId: parseInt(subId, 10),
      status: 'JUDGING',
      timestamp: Date.now()
    })
  );

  // Step 2: Simulate judging runtime delay (1000ms - 2000ms)
  const delayMs = Math.floor(Math.random() * 1000) + 1000;
  await new Promise((resolve) => setTimeout(resolve, delayMs));

  // Step 3: Fetch problem points
  // Redis command: HGET problem:<id> points
  const pointsStr = await workerClient.hget(`problem:${problemId}`, 'points');
  const points = parseInt(pointsStr || '100', 10);

  // Retrieve submitted code for realistic verdict determination
  // Redis command: HGET submission:<id> code
  const code = (await workerClient.hget(`submission:${subId}`, 'code')) || '';

  // Determine verdict:
  // Deterministic keywords support testing:
  // - "// AC" -> forces AC
  // - "// WA" -> forces WA
  // - "// TLE" -> forces TLE
  // Otherwise ~50% AC, ~30% WA, ~20% TLE
  let verdict = 'AC';
  if (code.includes('// WA') || code.includes('// FAIL')) {
    verdict = 'WA';
  } else if (code.includes('// TLE')) {
    verdict = 'TLE';
  } else if (code.includes('// AC')) {
    verdict = 'AC';
  } else {
    const rand = Math.random();
    if (rand < 0.50) verdict = 'AC';
    else if (rand < 0.80) verdict = 'WA';
    else verdict = 'TLE';
  }

  let pointsAwarded = 0;

  // Step 4: On AC, execute atomic Lua scoring script
  if (verdict === 'AC') {
    const solveResult = await executeAtomicSolve(
      workerClient,
      userId,
      problemId,
      points,
      contestId
    );

    if (solveResult.alreadySolved) {
      console.log(`[Judge Worker] User #${userId} previously solved Problem #${problemId}. Score unchanged.`);
      pointsAwarded = 0;
    } else {
      console.log(`[Judge Worker] User #${userId} solved Problem #${problemId}! New score: ${solveResult.newScore}`);
      pointsAwarded = points;

      // Update streak bitmap for current day of year
      const now = new Date();
      const start = new Date(now.getFullYear(), 0, 0);
      const diff = now - start;
      const dayOfYear = Math.floor(diff / 86400000);
      // Redis command: SETBIT streak:<userId>:<year> <dayOfYear> 1
      await workerClient.setbit(`streak:${userId}:${now.getFullYear()}`, dayOfYear, 1);
    }
  }

  const executionTime = verdict === 'TLE' ? 2050 : Math.floor(Math.random() * 120) + 15;
  const memory = Math.floor(Math.random() * 20) + 12;

  // Step 5: Update submission Hash with final verdict and execution metrics
  // Redis command: HSET submission:<id> ...
  await workerClient.hset(`submission:${subId}`, {
    status: 'COMPLETED',
    verdict,
    points: pointsAwarded.toString(),
    executionTime: executionTime.toString(),
    memory: memory.toString(),
    judgedAt: Date.now().toString()
  });

  // Step 6: Acknowledge the message in the stream consumer group
  // Redis command: XACK submissions judge-workers <messageId>
  await workerClient.xack(STREAM_KEY, GROUP_NAME, messageId);

  // Step 7: Broadcast completed verdict via Pub/Sub for live frontend notification
  // Redis command: PUBLISH lb:updates <json>
  await workerClient.publish(
    'lb:updates',
    JSON.stringify({
      type: 'submission_completed',
      submissionId: parseInt(subId, 10),
      userId: parseInt(userId, 10),
      username,
      problemId: parseInt(problemId, 10),
      verdict,
      points: pointsAwarded,
      timestamp: Date.now()
    })
  );

  console.log(`[Judge Worker] [${messageId}] Finished Submission #${subId}: ${verdict} (${executionTime}ms, ${memory}MB)`);
}

/**
 * Handle Pending Unacknowledged Messages (e.g. from previous crashed worker instances)
 */
async function processPendingMessages() {
  try {
    // Redis command: XREADGROUP GROUP judge-workers <consumer> COUNT 10 STREAMS submissions 0
    // Reading with ID '0' fetches pending messages assigned to this consumer
    const pendingResults = await workerClient.xreadgroup(
      'GROUP', GROUP_NAME, CONSUMER_NAME,
      'COUNT', 10,
      'STREAMS', STREAM_KEY, '0'
    );

    if (pendingResults && pendingResults.length > 0) {
      const streamEntries = pendingResults[0][1];
      for (const entry of streamEntries) {
        const [messageId, fieldsArray] = entry;
        const fields = parseStreamFields(fieldsArray);
        console.log(`[Judge Worker] Recovering pending message ${messageId}...`);
        await processSubmission(messageId, fields);
      }
    }
  } catch (err) {
    console.warn('[Judge Worker] Error recovering pending messages:', err.message);
  }
}

/**
 * Continuous worker loop using blocking XREADGROUP
 */
async function startWorker() {
  await initConsumerGroup();
  await processPendingMessages();

  console.log(`[Judge Worker] Ready and listening for jobs on stream '${STREAM_KEY}' (Consumer: ${CONSUMER_NAME})...`);

  while (isRunning) {
    try {
      // Redis command: XREADGROUP GROUP judge-workers <consumer> BLOCK 2000 COUNT 1 STREAMS submissions >
      // Blocks for up to 2000ms waiting for NEW undelivered messages (indicated by '>')
      const streamResults = await workerClient.xreadgroup(
        'GROUP', GROUP_NAME, CONSUMER_NAME,
        'BLOCK', 2000,
        'COUNT', 1,
        'STREAMS', STREAM_KEY, '>'
      );

      if (!streamResults || streamResults.length === 0) {
        continue; // Block timed out with no new messages, continue waiting
      }

      const streamEntries = streamResults[0][1];
      for (const entry of streamEntries) {
        const [messageId, fieldsArray] = entry;
        const fields = parseStreamFields(fieldsArray);
        await processSubmission(messageId, fields);
      }
    } catch (err) {
      if (isRunning) {
        console.error('[Judge Worker Loop Error]', err.message);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  await workerClient.quit();
  console.log('[Judge Worker] Stopped cleanly.');
}

// Graceful termination handling
process.on('SIGINT', async () => {
  console.log('\n[Judge Worker] Received SIGINT. Shutting down gracefully...');
  isRunning = false;
});

process.on('SIGTERM', async () => {
  console.log('\n[Judge Worker] Received SIGTERM. Shutting down gracefully...');
  isRunning = false;
});

startWorker().catch((err) => {
  console.error('[Judge Worker Fatal Error]', err);
  process.exit(1);
});
