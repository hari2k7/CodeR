import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { redis } from '../redis.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BENCH_USERS_COUNT = 100000;
const BATCH_SIZE = 5000;
const UPDATES_COUNT = 10000;

// Benchmark keys isolated from application data
const REDIS_BENCH_KEY = 'bench:lb';
const REDIS_CACHE_KEY = 'cache:bench:top100';

/**
 * High-resolution timer measurement helper
 */
async function measure(fn) {
  const start = process.hrtime.bigint();
  await fn();
  const end = process.hrtime.bigint();
  return Number(end - start) / 1000000; // ms with fractional precision
}

/**
 * Execute multiple iterations and calculate average and p95 latency
 */
async function runIterations(fn, iterations = 30) {
  const latencies = [];
  // Warm up
  await fn();

  for (let i = 0; i < iterations; i++) {
    const lat = await measure(fn);
    latencies.push(lat);
  }

  latencies.sort((a, b) => a - b);
  const avg = latencies.reduce((sum, val) => sum + val, 0) / latencies.length;
  const p95Index = Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95));
  const p95 = latencies[p95Index];
  const min = latencies[0];
  const max = latencies[latencies.length - 1];

  return {
    avg: Number(avg.toFixed(3)),
    p95: Number(p95.toFixed(3)),
    min: Number(min.toFixed(3)),
    max: Number(max.toFixed(3))
  };
}

/**
 * 1. SEED DATA (100,000 Users in Redis)
 */
async function seedBenchmarkData() {
  console.log(`\n[Benchmark Seeding] Preparing 100,000 users in Redis Sorted Set (${REDIS_BENCH_KEY})...`);

  // Clear previous benchmark data
  await redis.del(REDIS_BENCH_KEY, REDIS_CACHE_KEY);

  const startTime = Date.now();

  for (let i = 1; i <= BENCH_USERS_COUNT; i += BATCH_SIZE) {
    const end = Math.min(i + BATCH_SIZE - 1, BENCH_USERS_COUNT);
    const redisPipeline = redis.pipeline();

    for (let u = i; u <= end; u++) {
      const score = (u * 37) % 50000;
      // Redis: ZADD bench:lb score member
      redisPipeline.zadd(REDIS_BENCH_KEY, score, u.toString());
    }

    await redisPipeline.exec();
    process.stdout.write(`\r[Benchmark Seeding] Seeded ${end} / ${BENCH_USERS_COUNT} users (${Math.round((end / BENCH_USERS_COUNT) * 100)}%)`);
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n[Benchmark Seeding] 100,000 users seeded into Redis in ${durationSec}s.`);

  // Verify counts
  const redisCount = await redis.zcard(REDIS_BENCH_KEY);
  console.log(`[Benchmark Seeding] Verified Redis Sorted Set count: ${redisCount.toLocaleString()} members`);
}

async function runBenchmark() {
  await seedBenchmarkData();

  console.log('\n' + '='.repeat(80));
  console.log(' CODERANK REDIS PERFORMANCE BENCHMARK AT 100,000 USER SCALE');
  console.log('='.repeat(80) + '\n');

  // ---------------------------------------------------------------------------
  // TEST 1: Top-100 Leaderboard Retrieval (ZREVRANGE)
  // ---------------------------------------------------------------------------
  console.log('[Test 1/4] Measuring Top-100 Leaderboard Retrieval (30 iterations)...');
  const redisTop100 = await runIterations(async () => {
    // Redis command: ZREVRANGE bench:lb 0 99 WITHSCORES
    await redis.zrevrange(REDIS_BENCH_KEY, 0, 99, 'WITHSCORES');
  }, 30);
  console.log(`  -> Redis ZREVRANGE Top-100: Avg = ${redisTop100.avg} ms, p95 = ${redisTop100.p95} ms`);

  // ---------------------------------------------------------------------------
  // TEST 2: Single User Rank Retrieval (ZREVRANK)
  // ---------------------------------------------------------------------------
  console.log('\n[Test 2/4] Measuring Single User Rank Retrieval (30 iterations)...');
  const sampleUserIds = ['42', '1337', '9999', '50000', '99999'];
  const redisRank = await runIterations(async () => {
    for (const uid of sampleUserIds) {
      // Redis command: ZREVRANK bench:lb <uid>
      await redis.zrevrank(REDIS_BENCH_KEY, uid);
    }
  }, 30);
  redisRank.avg = Number((redisRank.avg / sampleUserIds.length).toFixed(3));
  redisRank.p95 = Number((redisRank.p95 / sampleUserIds.length).toFixed(3));
  console.log(`  -> Redis ZREVRANK: Avg = ${redisRank.avg} ms, p95 = ${redisRank.p95} ms`);

  // ---------------------------------------------------------------------------
  // TEST 3: 10,000 Rapid Score Updates (ZINCRBY)
  // ---------------------------------------------------------------------------
  console.log('\n[Test 3/4] Measuring 10,000 Rapid Score Updates (ZINCRBY)...');
  const redisUpdatesStart = process.hrtime.bigint();
  const updatePipeline = redis.pipeline();
  for (let i = 1; i <= UPDATES_COUNT; i++) {
    const randomUser = Math.floor(Math.random() * BENCH_USERS_COUNT) + 1;
    // Redis command: ZINCRBY bench:lb 100 <uid>
    updatePipeline.zincrby(REDIS_BENCH_KEY, 100, randomUser.toString());
  }
  await updatePipeline.exec();
  const redisUpdatesDurationMs = Number(process.hrtime.bigint() - redisUpdatesStart) / 1000000;
  const redisUpdatesThroughput = Math.round((UPDATES_COUNT / (redisUpdatesDurationMs / 1000)));
  console.log(`  -> Redis 10,000 Updates: Total = ${redisUpdatesDurationMs.toFixed(1)} ms, Throughput = ${redisUpdatesThroughput.toLocaleString()} ops/sec`);

  // ---------------------------------------------------------------------------
  // TEST 4: Cached Read vs Uncached Query
  // ---------------------------------------------------------------------------
  console.log('\n[Test 4/4] Measuring Cache Hit vs Uncached Read...');
  const top100Data = await redis.zrevrange(REDIS_BENCH_KEY, 0, 99, 'WITHSCORES');
  await redis.set(REDIS_CACHE_KEY, JSON.stringify(top100Data), 'EX', 5);

  const cacheHit = await runIterations(async () => {
    await redis.get(REDIS_CACHE_KEY);
  }, 30);
  console.log(`  -> Cache Hit (GET String): Avg = ${cacheHit.avg} ms, p95 = ${cacheHit.p95} ms`);

  // ---------------------------------------------------------------------------
  // SUMMARY TABLE
  // ---------------------------------------------------------------------------
  console.log('\n' + '='.repeat(80));
  console.log(' REDIS 100,000 USER BENCHMARK RESULTS SUMMARY');
  console.log('='.repeat(80));

  const summary = [
    {
      'Operation': 'Top-100 Leaderboard',
      'Redis Command': 'ZREVRANGE bench:lb 0 99',
      'Average Latency': `${redisTop100.avg} ms`,
      'p95 Latency': `${redisTop100.p95} ms`,
      'Throughput / Note': 'Instant RAM access'
    },
    {
      'Operation': 'Single User Rank',
      'Redis Command': 'ZREVRANK bench:lb <id>',
      'Average Latency': `${redisRank.avg} ms`,
      'p95 Latency': `${redisRank.p95} ms`,
      'Throughput / Note': 'O(log(N)) Skip List'
    },
    {
      'Operation': '10,000 Score Updates',
      'Redis Command': 'ZINCRBY bench:lb 100 <id>',
      'Average Latency': `${(redisUpdatesDurationMs / UPDATES_COUNT).toFixed(3)} ms`,
      'p95 Latency': `${(redisUpdatesDurationMs).toFixed(1)} ms total`,
      'Throughput / Note': `${redisUpdatesThroughput.toLocaleString()} ops/sec`
    },
    {
      'Operation': 'Cached Top-100 Read',
      'Redis Command': 'GET cache:bench:top100',
      'Average Latency': `${cacheHit.avg} ms`,
      'p95 Latency': `${cacheHit.p95} ms`,
      'Throughput / Note': 'Sub-millisecond key-value'
    }
  ];

  console.table(summary);
  console.log('Benchmark completed successfully with 100% Redis datastore.\n');

  // Clean up benchmark keys
  await redis.del(REDIS_BENCH_KEY, REDIS_CACHE_KEY);
  process.exit(0);
}

runBenchmark().catch((err) => {
  console.error('[Benchmark Error]', err);
  process.exit(1);
});
