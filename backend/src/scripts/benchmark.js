import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { redis } from '../redis.js';
import { pool } from '../mysql.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BENCH_USERS_COUNT = 100000;
const BATCH_SIZE = 5000;
const UPDATES_COUNT = 10000;

// Benchmark keys & tables isolated from application data
const REDIS_BENCH_KEY = 'bench:lb';
const REDIS_CACHE_KEY = 'cache:bench:top100';
const MYSQL_BENCH_TABLE = 'bench_users';

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

  return { avg: Number(avg.toFixed(3)), p95: Number(p95.toFixed(3)), min: Number(min.toFixed(3)), max: Number(max.toFixed(3)) };
}

/**
 * 1. SEED DATA (100,000 Users)
 */
async function seedBenchmarkData() {
  console.log(`\n[Benchmark Seeding] Preparing 100,000 identical records in Redis and MySQL...`);

  // Clear previous benchmark data
  await redis.del(REDIS_BENCH_KEY, REDIS_CACHE_KEY);
  await pool.query(`TRUNCATE TABLE ${MYSQL_BENCH_TABLE}`);

  const startTime = Date.now();

  for (let i = 1; i <= BENCH_USERS_COUNT; i += BATCH_SIZE) {
    const end = Math.min(i + BATCH_SIZE - 1, BENCH_USERS_COUNT);

    const redisPipeline = redis.pipeline();
    const mysqlRows = [];

    for (let u = i; u <= end; u++) {
      const score = (u * 37) % 50000;
      const username = `bench_user_${u}`;

      // Redis: ZADD bench:lb score member
      redisPipeline.zadd(REDIS_BENCH_KEY, score, u.toString());

      // MySQL: batch array
      mysqlRows.push([u, username, score]);
    }

    // Execute Redis Pipeline
    await redisPipeline.exec();

    // Execute MySQL Multi-row Insert
    const insertSql = `INSERT INTO ${MYSQL_BENCH_TABLE} (id, username, score) VALUES ?`;
    await pool.query(insertSql, [mysqlRows]);

    process.stdout.write(`\r[Benchmark Seeding] Seeded ${end} / ${BENCH_USERS_COUNT} users (${Math.round((end / BENCH_USERS_COUNT) * 100)}%)`);
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n[Benchmark Seeding] 100,000 users seeded in ${durationSec}s.`);

  // Verify counts
  const redisCount = await redis.zcard(REDIS_BENCH_KEY);
  const [mysqlCountRows] = await pool.query(`SELECT COUNT(*) as total FROM ${MYSQL_BENCH_TABLE}`);
  const mysqlCount = mysqlCountRows[0].total;
  console.log(`[Benchmark Seeding] Verified counts -> Redis: ${redisCount}, MySQL: ${mysqlCount}`);
}

async function runBenchmark() {
  await seedBenchmarkData();

  console.log('\n' + '='.repeat(80));
  console.log(' BENCHMARK TEST SUITE: REDIS VS MYSQL AT 100,000 USER SCALE');
  console.log('='.repeat(80) + '\n');

  // ---------------------------------------------------------------------------
  // TEST 1: Top-100 Leaderboard Retrieval
  // ---------------------------------------------------------------------------
  console.log('1. Benchmarking Top-100 Leaderboard Retrieval (30 runs)...');
  const redisTop100 = await runIterations(async () => {
    // Redis: ZREVRANGE bench:lb 0 99 WITHSCORES
    await redis.zrevrange(REDIS_BENCH_KEY, 0, 99, 'WITHSCORES');
  }, 30);

  const mysqlTop100 = await runIterations(async () => {
    // MySQL: Indexed ORDER BY score DESC LIMIT 100
    await pool.query(`SELECT id, username, score FROM ${MYSQL_BENCH_TABLE} ORDER BY score DESC LIMIT 100`);
  }, 30);

  // ---------------------------------------------------------------------------
  // TEST 2: Single User Rank Calculation
  // ---------------------------------------------------------------------------
  console.log('2. Benchmarking Single User Rank Calculation (30 runs across sample users)...');
  const sampleUserIds = [42, 500, 1250, 15000, 45000, 75000, 99999];

  const redisRank = await runIterations(async () => {
    for (const uid of sampleUserIds) {
      // Redis: ZREVRANK bench:lb <id> (O(log(N)) skip-list rank query)
      await redis.zrevrank(REDIS_BENCH_KEY, uid.toString());
    }
  }, 30);
  // Normalize to per-query latency
  redisRank.avg = Number((redisRank.avg / sampleUserIds.length).toFixed(3));
  redisRank.p95 = Number((redisRank.p95 / sampleUserIds.length).toFixed(3));

  const mysqlRank = await runIterations(async () => {
    for (const uid of sampleUserIds) {
      // MySQL: SELECT COUNT(*)+1 FROM bench_users WHERE score > (SELECT score FROM bench_users WHERE id = ?)
      await pool.query(`
        SELECT COUNT(*) + 1 AS user_rank
        FROM ${MYSQL_BENCH_TABLE}
        WHERE score > (SELECT score FROM ${MYSQL_BENCH_TABLE} WHERE id = ?)
      `, [uid]);
    }
  }, 30);
  mysqlRank.avg = Number((mysqlRank.avg / sampleUserIds.length).toFixed(3));
  mysqlRank.p95 = Number((mysqlRank.p95 / sampleUserIds.length).toFixed(3));

  // ---------------------------------------------------------------------------
  // TEST 3: 10,000 Score Updates (Throughput & Latency)
  // ---------------------------------------------------------------------------
  console.log('3. Benchmarking 10,000 Score Updates...');

  // Redis: Pipelined ZINCRBY in batches of 1,000
  const redisUpdatesStart = process.hrtime.bigint();
  for (let i = 1; i <= UPDATES_COUNT; i += 1000) {
    const pipe = redis.pipeline();
    for (let u = i; u < i + 1000; u++) {
      pipe.zincrby(REDIS_BENCH_KEY, 100, u.toString());
    }
    await pipe.exec();
  }
  const redisUpdatesDurationMs = Number(process.hrtime.bigint() - redisUpdatesStart) / 1000000;
  const redisUpdatesThroughput = Math.round((UPDATES_COUNT / (redisUpdatesDurationMs / 1000)));

  // MySQL: Batched transactions of updates
  const mysqlUpdatesStart = process.hrtime.bigint();
  const conn = await pool.getConnection();
  try {
    for (let i = 1; i <= UPDATES_COUNT; i += 1000) {
      await conn.beginTransaction();
      for (let u = i; u < i + 1000; u++) {
        await conn.query(`UPDATE ${MYSQL_BENCH_TABLE} SET score = score + 100 WHERE id = ?`, [u]);
      }
      await conn.commit();
    }
  } finally {
    conn.release();
  }
  const mysqlUpdatesDurationMs = Number(process.hrtime.bigint() - mysqlUpdatesStart) / 1000000;
  const mysqlUpdatesThroughput = Math.round((UPDATES_COUNT / (mysqlUpdatesDurationMs / 1000)));

  // ---------------------------------------------------------------------------
  // TEST 4: Cached vs Uncached Top-100 (Redis Cache Evaluation)
  // ---------------------------------------------------------------------------
  console.log('4. Benchmarking Cached vs Uncached Top-100 API Reads (50 runs)...');
  // Seed the pre-serialized cache string
  const top100Raw = await redis.zrevrange(REDIS_BENCH_KEY, 0, 99, 'WITHSCORES');
  await redis.set(REDIS_CACHE_KEY, JSON.stringify(top100Raw), 'EX', 60);

  const uncachedRead = await runIterations(async () => {
    // Uncached: ZREVRANGE calculation on Sorted Set
    await redis.zrevrange(REDIS_BENCH_KEY, 0, 99, 'WITHSCORES');
  }, 50);

  const cachedRead = await runIterations(async () => {
    // Cached: GET on pre-computed JSON String
    await redis.get(REDIS_CACHE_KEY);
  }, 50);

  // ---------------------------------------------------------------------------
  // Clean up benchmark test keys
  // ---------------------------------------------------------------------------
  await redis.del(REDIS_BENCH_KEY, REDIS_CACHE_KEY);
  await pool.query(`TRUNCATE TABLE ${MYSQL_BENCH_TABLE}`);
  await pool.end();

  // ---------------------------------------------------------------------------
  // Compile Results & Summary
  // ---------------------------------------------------------------------------
  const results = {
    metadata: {
      scale: `${BENCH_USERS_COUNT.toLocaleString()} Users`,
      date: new Date().toISOString(),
      nodeVersion: process.version,
      redisHost: process.env.REDIS_HOST || 'localhost',
      mysqlDatabase: process.env.MYSQL_DATABASE || 'codered_db'
    },
    tests: {
      top100Leaderboard: {
        unit: 'ms per query',
        redis: redisTop100,
        mysql: mysqlTop100,
        speedupFactor: Number((mysqlTop100.avg / redisTop100.avg).toFixed(1))
      },
      singleUserRank: {
        unit: 'ms per query',
        redis: redisRank,
        mysql: mysqlRank,
        speedupFactor: Number((mysqlRank.avg / redisRank.avg).toFixed(1))
      },
      scoreUpdates10k: {
        unit: 'total ms & ops/sec',
        redis: {
          totalDurationMs: Number(redisUpdatesDurationMs.toFixed(1)),
          opsPerSec: redisUpdatesThroughput
        },
        mysql: {
          totalDurationMs: Number(mysqlUpdatesDurationMs.toFixed(1)),
          opsPerSec: mysqlUpdatesThroughput
        },
        speedupFactor: Number((mysqlUpdatesDurationMs / redisUpdatesDurationMs).toFixed(1))
      },
      cacheComparison: {
        unit: 'ms per query',
        uncachedZrevrange: uncachedRead,
        cachedStringGet: cachedRead,
        cacheSpeedupFactor: Number((uncachedRead.avg / cachedRead.avg).toFixed(1))
      }
    }
  };

  // Print Console Table
  console.log('\n' + '='.repeat(80));
  console.log(' BENCHMARK COMPARISON TABLE (100,000 USERS SCALE)');
  console.log('='.repeat(80));

  const tableSummary = [
    {
      'Workload Benchmark': 'Top-100 Leaderboard',
      'Redis (Avg / p95)': `${redisTop100.avg} ms / ${redisTop100.p95} ms`,
      'MySQL (Avg / p95)': `${mysqlTop100.avg} ms / ${mysqlTop100.p95} ms`,
      'Speedup Multiplier': `${results.tests.top100Leaderboard.speedupFactor}x Faster`
    },
    {
      'Workload Benchmark': 'Single User Rank (ZREVRANK)',
      'Redis (Avg / p95)': `${redisRank.avg} ms / ${redisRank.p95} ms`,
      'MySQL (Avg / p95)': `${mysqlRank.avg} ms / ${mysqlRank.p95} ms`,
      'Speedup Multiplier': `${results.tests.singleUserRank.speedupFactor}x Faster`
    },
    {
      'Workload Benchmark': '10,000 Score Updates',
      'Redis (Avg / p95)': `${redisUpdatesDurationMs.toFixed(0)} ms (${redisUpdatesThroughput.toLocaleString()} ops/s)`,
      'MySQL (Avg / p95)': `${mysqlUpdatesDurationMs.toFixed(0)} ms (${mysqlUpdatesThroughput.toLocaleString()} ops/s)`,
      'Speedup Multiplier': `${results.tests.scoreUpdates10k.speedupFactor}x Faster`
    },
    {
      'Workload Benchmark': 'Cached vs Uncached (Top-100)',
      'Redis (Avg / p95)': `Cached: ${cachedRead.avg} ms (p95: ${cachedRead.p95} ms)`,
      'MySQL (Avg / p95)': `Uncached: ${uncachedRead.avg} ms (p95: ${uncachedRead.p95} ms)`,
      'Speedup Multiplier': `${results.tests.cacheComparison.cacheSpeedupFactor}x Faster`
    }
  ];

  console.table(tableSummary);

  // ---------------------------------------------------------------------------
  // Write docs/benchmark-results.json
  // ---------------------------------------------------------------------------
  const docsDir = path.resolve(__dirname, '../../../docs');
  const jsonPath = path.join(docsDir, 'benchmark-results.json');
  fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2), 'utf8');
  console.log(`[Benchmark Output] Wrote results JSON -> ${jsonPath}`);

  // ---------------------------------------------------------------------------
  // Write docs/benchmark-results.csv
  // ---------------------------------------------------------------------------
  const csvPath = path.join(docsDir, 'benchmark-results.csv');
  const csvContent = [
    'Workload,System,Metric,Avg_ms,p95_ms,Min_ms,Max_ms,Speedup_Factor',
    `Top-100 Leaderboard,Redis,Query Latency,${redisTop100.avg},${redisTop100.p95},${redisTop100.min},${redisTop100.max},${results.tests.top100Leaderboard.speedupFactor}x`,
    `Top-100 Leaderboard,MySQL,Query Latency,${mysqlTop100.avg},${mysqlTop100.p95},${mysqlTop100.min},${mysqlTop100.max},1.0x`,
    `Single User Rank,Redis,Query Latency,${redisRank.avg},${redisRank.p95},${redisRank.min},${redisRank.max},${results.tests.singleUserRank.speedupFactor}x`,
    `Single User Rank,MySQL,Query Latency,${mysqlRank.avg},${mysqlRank.p95},${mysqlRank.min},${mysqlRank.max},1.0x`,
    `10000 Updates,Redis,Throughput (ops/s),${redisUpdatesThroughput},N/A,N/A,N/A,${results.tests.scoreUpdates10k.speedupFactor}x`,
    `10000 Updates,MySQL,Throughput (ops/s),${mysqlUpdatesThroughput},N/A,N/A,N/A,1.0x`,
    `Top-100 Cached vs Uncached,Redis Cached String,Query Latency,${cachedRead.avg},${cachedRead.p95},${cachedRead.min},${cachedRead.max},${results.tests.cacheComparison.cacheSpeedupFactor}x`,
    `Top-100 Cached vs Uncached,Redis Uncached ZSET,Query Latency,${uncachedRead.avg},${uncachedRead.p95},${uncachedRead.min},${uncachedRead.max},1.0x`
  ].join('\n');
  fs.writeFileSync(csvPath, csvContent, 'utf8');
  console.log(`[Benchmark Output] Wrote results CSV -> ${csvPath}`);

  // ---------------------------------------------------------------------------
  // Generate docs/benchmark-chart.html (Self-contained HTML Dashboard)
  // ---------------------------------------------------------------------------
  const chartHtmlPath = path.join(docsDir, 'benchmark-chart.html');
  const chartHtmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>CodeRank • Redis vs MySQL Benchmark Report (100k Users)</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0A0E17;
      color: #F9FAFB;
      padding: 2.5rem;
      margin: 0;
    }
    .header {
      text-align: center;
      margin-bottom: 2.5rem;
    }
    h1 { font-size: 2.2rem; margin-bottom: 0.5rem; }
    .subtitle { color: #9CA3AF; font-size: 1rem; }
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 1.5rem;
      margin-bottom: 2.5rem;
    }
    .metric-card {
      background: #111827;
      border: 1px solid #1F2937;
      border-radius: 12px;
      padding: 1.5rem;
      text-align: center;
    }
    .metric-title { font-size: 0.85rem; color: #9CA3AF; text-transform: uppercase; font-weight: 600; }
    .metric-value { font-size: 2rem; font-weight: 800; color: #10B981; margin: 0.5rem 0; }
    .metric-sub { font-size: 0.85rem; color: #6B7280; }
    .charts-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 2rem;
      margin-bottom: 2.5rem;
    }
    .chart-card {
      background: #111827;
      border: 1px solid #1F2937;
      border-radius: 12px;
      padding: 1.5rem;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 1rem;
      background: #111827;
      border-radius: 12px;
      overflow: hidden;
      border: 1px solid #1F2937;
    }
    th, td { padding: 1rem 1.25rem; text-align: left; }
    th { background: #1F2937; font-size: 0.8rem; text-transform: uppercase; color: #9CA3AF; }
    td { border-bottom: 1px solid #1F2937; }
    .badge-speedup {
      background: rgba(16, 185, 129, 0.15);
      color: #10B981;
      border: 1px solid rgba(16, 185, 129, 0.3);
      padding: 0.25rem 0.6rem;
      border-radius: 9999px;
      font-weight: 700;
      font-size: 0.85rem;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Redis vs MySQL Performance Benchmark</h1>
    <div class="subtitle">Evaluated on ${BENCH_USERS_COUNT.toLocaleString()} Concurrent User Scale • University DBMS Case Study</div>
  </div>

  <div class="metrics-grid">
    <div class="metric-card">
      <div class="metric-title">Leaderboard Query Speedup</div>
      <div class="metric-value">${results.tests.top100Leaderboard.speedupFactor}x</div>
      <div class="metric-sub">${redisTop100.avg}ms (Redis) vs ${mysqlTop100.avg}ms (MySQL)</div>
    </div>
    <div class="metric-card">
      <div class="metric-title">Rank Calculation Speedup</div>
      <div class="metric-value">${results.tests.singleUserRank.speedupFactor}x</div>
      <div class="metric-sub">${redisRank.avg}ms (ZREVRANK) vs ${mysqlRank.avg}ms (COUNT(*))</div>
    </div>
    <div class="metric-card">
      <div class="metric-title">10,000 Score Updates</div>
      <div class="metric-value">${results.tests.scoreUpdates10k.speedupFactor}x</div>
      <div class="metric-sub">${redisUpdatesThroughput.toLocaleString()} ops/s vs ${mysqlUpdatesThroughput.toLocaleString()} ops/s</div>
    </div>
    <div class="metric-card">
      <div class="metric-title">Cache Speedup Factor</div>
      <div class="metric-value">${results.tests.cacheComparison.cacheSpeedupFactor}x</div>
      <div class="metric-sub">${cachedRead.avg}ms (Cache HIT) vs ${uncachedRead.avg}ms (Cache MISS)</div>
    </div>
  </div>

  <div class="charts-grid">
    <div class="chart-card">
      <h3>Query Latency Comparison (Lower is Better)</h3>
      <canvas id="latencyChart"></canvas>
    </div>
    <div class="chart-card">
      <h3>Write Throughput (Higher is Better)</h3>
      <canvas id="throughputChart"></canvas>
    </div>
  </div>

  <div class="chart-card">
    <h3>Detailed Benchmark Results Summary</h3>
    <table>
      <thead>
        <tr>
          <th>Workload Scenario</th>
          <th>Redis Avg (p95)</th>
          <th>MySQL Avg (p95)</th>
          <th>Speedup Factor</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><strong>Top-100 Leaderboard</strong> (<code>ZREVRANGE</code> vs <code>ORDER BY score DESC LIMIT 100</code>)</td>
          <td>${redisTop100.avg} ms (${redisTop100.p95} ms)</td>
          <td>${mysqlTop100.avg} ms (${mysqlTop100.p95} ms)</td>
          <td><span class="badge-speedup">${results.tests.top100Leaderboard.speedupFactor}x Faster</span></td>
        </tr>
        <tr>
          <td><strong>Single User Rank</strong> (<code>ZREVRANK</code> vs <code>COUNT(*) WHERE score &gt; ?</code>)</td>
          <td>${redisRank.avg} ms (${redisRank.p95} ms)</td>
          <td>${mysqlRank.avg} ms (${mysqlRank.p95} ms)</td>
          <td><span class="badge-speedup">${results.tests.singleUserRank.speedupFactor}x Faster</span></td>
        </tr>
        <tr>
          <td><strong>10,000 Score Updates</strong> (Pipelined <code>ZINCRBY</code> vs Transactional <code>UPDATE</code>)</td>
          <td>${redisUpdatesDurationMs.toFixed(0)} ms (${redisUpdatesThroughput.toLocaleString()} ops/sec)</td>
          <td>${mysqlUpdatesDurationMs.toFixed(0)} ms (${mysqlUpdatesThroughput.toLocaleString()} ops/sec)</td>
          <td><span class="badge-speedup">${results.tests.scoreUpdates10k.speedupFactor}x Faster</span></td>
        </tr>
        <tr>
          <td><strong>Cached vs Uncached Read</strong> (Redis String <code>GET</code> vs <code>ZREVRANGE</code>)</td>
          <td>${cachedRead.avg} ms (${cachedRead.p95} ms)</td>
          <td>${uncachedRead.avg} ms (${uncachedRead.p95} ms)</td>
          <td><span class="badge-speedup">${results.tests.cacheComparison.cacheSpeedupFactor}x Faster</span></td>
        </tr>
      </tbody>
    </table>
  </div>

  <script>
    new Chart(document.getElementById('latencyChart'), {
      type: 'bar',
      data: {
        labels: ['Top-100 Retrieval', 'Single User Rank'],
        datasets: [
          { label: 'Redis (ms)', data: [${redisTop100.avg}, ${redisRank.avg}], backgroundColor: '#10B981' },
          { label: 'MySQL (ms)', data: [${mysqlTop100.avg}, ${mysqlRank.avg}], backgroundColor: '#F43F5E' }
        ]
      },
      options: {
        responsive: true,
        plugins: { legend: { labels: { color: '#9CA3AF' } } },
        scales: {
          x: { ticks: { color: '#9CA3AF' }, grid: { color: '#1F2937' } },
          y: { ticks: { color: '#9CA3AF' }, grid: { color: '#1F2937' }, title: { display: true, text: 'Milliseconds (ms)', color: '#9CA3AF' } }
        }
      }
    });

    new Chart(document.getElementById('throughputChart'), {
      type: 'bar',
      data: {
        labels: ['Write Throughput (ops/sec)'],
        datasets: [
          { label: 'Redis (ops/s)', data: [${redisUpdatesThroughput}], backgroundColor: '#10B981' },
          { label: 'MySQL (ops/s)', data: [${mysqlUpdatesThroughput}], backgroundColor: '#F43F5E' }
        ]
      },
      options: {
        responsive: true,
        plugins: { legend: { labels: { color: '#9CA3AF' } } },
        scales: {
          x: { ticks: { color: '#9CA3AF' }, grid: { color: '#1F2937' } },
          y: { ticks: { color: '#9CA3AF' }, grid: { color: '#1F2937' }, title: { display: true, text: 'Operations / Second', color: '#9CA3AF' } }
        }
      }
    });
  </script>
</body>
</html>`;
  fs.writeFileSync(chartHtmlPath, chartHtmlContent, 'utf8');
  console.log(`[Benchmark Output] Generated chart HTML dashboard -> ${chartHtmlPath}`);

  console.log('\n[Benchmark] Complete!');
  process.exit(0);
}

runBenchmark().catch((err) => {
  console.error('[Benchmark Error]', err);
  process.exit(1);
});
