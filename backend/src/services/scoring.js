import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const solveLuaPath = path.join(__dirname, '..', 'lua', 'solve.lua');
const solveLuaCode = fs.readFileSync(solveLuaPath, 'utf8');

/**
 * Execute Atomic Problem Solve & Scoring Script
 *
 * Atomically checks SISMEMBER, adds to solved Set, increments Sorted Set leaderboard(s),
 * increments user profile solved counter, increments college leaderboard, and PUBLISHes to lb:updates.
 *
 * @param {import('ioredis').Redis} client - The Redis client to execute on
 * @param {string|number} userId
 * @param {string|number} problemId
 * @param {number} points
 * @param {string|number} [contestId='']
 * @returns {Promise<{ alreadySolved: boolean, newScore: number }>}
 */
export async function executeAtomicSolve(client, userId, problemId, points, contestId = '') {
  // Execute Lua script directly with EVAL to ensure atomic execution on any client instance
  // Redis command: EVAL <script> 0 <userId> <problemId> <points> <contestId>
  const result = await client.eval(
    solveLuaCode,
    0,
    userId.toString(),
    problemId.toString(),
    points.toString(),
    contestId ? contestId.toString() : ''
  );

  const numericResult = Number(result);
  return {
    alreadySolved: numericResult === 0,
    newScore: numericResult
  };
}
