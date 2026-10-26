import Redis from 'ioredis';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Redis connection options (supports standalone localhost, auth credentials, and cloud endpoints)
const redisOptions = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  username: process.env.REDIS_USERNAME || undefined,
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null, // Required for reliable stream blocking and consumer groups
  retryStrategy(times) {
    const delay = Math.min(times * 100, 3000);
    return delay;
  },
  lazyConnect: false
};

// 1. Primary Redis client for application queries, hashes, sets, sorted sets, and transactions
export const redis = new Redis(redisOptions);

// 2. Dedicated Redis client for Pub/Sub subscribers (SSE leaderboard streaming).
// NOTE: An ioredis client placed in subscriber mode enters a dedicated state and
// cannot issue regular data commands (like GET/SET). Therefore, a separate connection is mandatory.
export const subscriberClient = new Redis(redisOptions);

// 3. Dedicated Redis client generator for blocking consumer-group worker calls (XREADGROUP ... BLOCK).
// Blocking commands hold the TCP connection until an item arrives or timeout expires.
export function createWorkerClient() {
  return new Redis(redisOptions);
}

// Load and register the atomic solve Lua script into Redis
const solveLuaPath = path.join(__dirname, 'lua', 'solve.lua');
let solveLuaCode = '';
try {
  solveLuaCode = fs.readFileSync(solveLuaPath, 'utf8');
  // Define custom command: solveProblem(userId, problemId, points, contestId)
  // numberOfKeys is 0 because all keys are computed dynamically inside the script.
  redis.defineCommand('solveProblem', {
    numberOfKeys: 0,
    lua: solveLuaCode
  });
} catch (err) {
  console.warn('[Redis] Warning: Unable to read solve.lua:', err.message);
}

// Error handling to avoid unhandled rejections
redis.on('error', (err) => console.error('[Redis Main Error]', err.message));
subscriberClient.on('error', (err) => console.error('[Redis Subscriber Error]', err.message));

// Helper: check loaded Redis modules at runtime (e.g. bf, search)
export async function checkModules() {
  try {
    // Redis command: MODULE LIST to inspect dynamically loaded C modules
    const modules = await redis.module('LIST');
    const moduleNames = modules.map((m) => (Array.isArray(m) ? m[1] : m.name || m));
    const hasBloom = moduleNames.some((n) => typeof n === 'string' && n.toLowerCase().includes('bf'));
    const hasSearch = moduleNames.some((n) => typeof n === 'string' && (n.toLowerCase().includes('search') || n.toLowerCase().includes('ft')));
    return {
      moduleNames,
      hasBloom,
      hasSearch
    };
  } catch (err) {
    console.warn('[Redis] Failed to query MODULE LIST:', err.message);
    return { moduleNames: [], hasBloom: false, hasSearch: false };
  }
}

export default redis;
