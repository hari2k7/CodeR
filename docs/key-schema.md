# CodeRank Redis Key Schema & Architecture

CodeRank is designed as a university DBMS case study showcasing Redis as the primary, real-time datastore. This document catalogs all key patterns, data types, TTL policies, and operational purposes across the platform.

---

## 1. Key Schema Summary Table

| Key Pattern | Redis Type | TTL / Eviction | Purpose / Description | Sample Commands |
| :--- | :--- | :--- | :--- | :--- |
| `user:id_seq` | String (Integer) | None (Permanent) | Atomic sequence counter for user IDs | `INCR user:id_seq` |
| `user:{id}` | Hash | None (Permanent) | User profile (username, email, passwordHash, rating, solved, college, createdAt) | `HGETALL user:1`, `HINCRBY user:1 solved 1` |
| `user:email:{email}` | String | None (Permanent) | Atomic unique email-to-userId lookup index | `SETNX user:email:alice@code.edu 1` |
| `user:name:{username}` | String | None (Permanent) | Atomic unique username-to-userId lookup index | `SETNX user:name:alice 1` |
| `usernames` | Set | None (Permanent) | Fast username set for uniqueness validation (fallback when Bloom is disabled) | `SISMEMBER usernames alice` |
| `bf:usernames` | Bloom Filter | None (Permanent) | Probabilistic set for instant username availability checks (when `bf` module is active) | `BF.ADD bf:usernames alice`, `BF.EXISTS bf:usernames alice` |
| `pending:{email}` | Hash | 600 seconds (10 min) | Staging area for unverified user registration data pending OTP verification | `HSET pending:alice@code.edu ...`, `EXPIRE pending:... 600` |
| `otp:{email}` | String | 300 seconds (5 min) | Cryptographic 6-digit one-time password for email verification | `SET otp:alice@code.edu 489201 EX 300` |
| `rl:otp:{email}` | String (Integer) | 600 seconds (10 min) | Rate limiter: Maximum 3 OTP resends per 10 minutes | `INCR rl:otp:...`, `EXPIRE rl:otp:... 600` |
| `rl:otpfail:{email}` | String (Integer) | 600 seconds (10 min) | Brute-force guard: Max 5 invalid OTP attempts before invalidating OTP | `INCR rl:otpfail:...` |
| `rl:login:{ip}` | String (Integer) | 900 seconds (15 min) | Brute-force guard: Max 5 failed logins triggers a 15-minute IP lockout | `INCR rl:login:127.0.0.1`, `TTL rl:login:127.0.0.1` |
| `session:{token}` | Hash | 3600 seconds (1 hour) | Active user session data `{userId, username, createdAt, ip}` with sliding expiry | `HSET session:<token> ...`, `EXPIRE session:<token> 3600` |
| `problem:id_seq` | String (Integer) | None (Permanent) | Atomic sequence counter for problem IDs | `INCR problem:id_seq` |
| `problem:{id}` | Hash | None (Permanent) | Problem details `{id, title, statement, difficulty, points, tags, timeLimit, memoryLimit, createdAt}` | `HGETALL problem:1`, `HMSET problem:1 ...` |
| `tag:{name}` | Set | None (Permanent) | Inverted index of problem IDs grouped by tag (e.g. `tag:dp`, `tag:graph`) | `SADD tag:dp 1 4 7`, `SINTER tag:dp tag:tree` |
| `difficulty:{level}` | Set | None (Permanent) | Inverted index of problem IDs grouped by difficulty (`easy`, `medium`, `hard`) | `SADD difficulty:easy 1 2 3` |
| `all:problems` | Set | None (Permanent) | Set of all active problem IDs for fast discovery and random selection | `SMEMBERS all:problems`, `SCARD all:problems` |
| `submissions` | Stream | Maxlen ~100k (optional trim) | Append-only execution queue ingested by judge consumer group (`judge-workers`) | `XADD submissions * problemId 1 userId 2 code ...`, `XREADGROUP ...` |
| `submission:id_seq` | String (Integer) | None (Permanent) | Atomic sequence counter for submission IDs | `INCR submission:id_seq` |
| `submission:{id}` | Hash | None (Permanent) | Submission metadata, status (`PENDING`, `JUDGING`, `AC`, `WA`, `TLE`), verdict, execution time | `HSET submission:1 ...`, `HGETALL submission:1` |
| `user:{id}:history` | List | Capped to 50 items | Recent submission IDs for a user profile view | `LPUSH user:1:history 105`, `LTRIM user:1:history 0 49` |
| `solved:{userId}` | Set | None (Permanent) | Set of problem IDs solved by user. Guards against duplicate points awards | `SISMEMBER solved:1 42`, `SADD solved:1 42` |
| `lb:global` | Sorted Set (ZSET) | None (Permanent) | Global leaderboard. Member = `userId`, Score = `totalPoints` | `ZREVRANGE lb:global 0 19 WITHSCORES`, `ZREVRANK lb:global 1` |
| `lb:contest:{id}` | Sorted Set (ZSET) | None (Permanent) | Contest-specific real-time leaderboard | `ZINCRBY lb:contest:1 100 4`, `ZREVRANGE lb:contest:1 0 9` |
| `lb:college` | Sorted Set (ZSET) | None (Permanent) | University/college aggregate leaderboard | `ZINCRBY lb:college 100 "MIT"`, `ZREVRANGE lb:college 0 9` |
| `cache:lb:top100` | String (JSON) | 5 seconds | Short-lived cache of top-100 leaderboard JSON for high-throughput reads | `SET cache:lb:top100 <json> EX 5` |
| `contest:id_seq` | String (Integer) | None (Permanent) | Atomic sequence counter for contest IDs | `INCR contest:id_seq` |
| `contest:{id}` | Hash | None (Permanent) | Contest metadata `{id, name, description, startTime, endTime, status}` | `HGETALL contest:1` |
| `contest:{id}:active`| String | `EXPIREAT endTime` | Ephemeral flag active only during contest window | `SET contest:1:active 1 EXPIREAT 1761500000` |
| `streak:{userId}:{year}` | Bitmap | None (Permanent) | Daily solve activity bitmap. Bit index = day of year (1-366) | `SETBIT streak:1:2026 299 1`, `BITCOUNT streak:1:2026` |
| `visitors:{YYYY-MM-DD}` | HyperLogLog | None (Permanent) | Unique daily visitor cardinality estimation (UV counter) | `PFADD visitors:2026-10-26 192.168.1.1`, `PFCOUNT visitors:2026-10-26` |
| `visitors:weekly:{week}` | HyperLogLog | None (Permanent) | Aggregated weekly unique visitor estimation via union | `PFMERGE visitors:weekly:43 visitors:2026-10-20 ...` |
| `bench:*` | Various | Short-lived | Namespaced benchmark keys (100k users, ZSET, etc.) separate from app data | `ZADD bench:lb ...` |

---

## 2. Redis Data Structures Utilized

1. **Hashes (`HSET`, `HGET`, `HGETALL`, `HINCRBY`)**:
   Used for structured records (`user:{id}`, `problem:{id}`, `submission:{id}`, `session:{token}`). Allows updating single fields (like `solved` count or `status`) without serializing/deserializing the entire JSON document.
2. **Strings & Integers (`SET`, `GET`, `INCR`, `SETNX`, `EXPIRE`)**:
   Used for atomic ID generators (`user:id_seq`), unique constraint enforcement (`user:name:{username}`), transient OTP codes (`otp:{email}`), and rate-limit counters (`rl:login:{ip}`).
3. **Sets (`SADD`, `SREM`, `SISMEMBER`, `SINTER`, `SUNION`)**:
   Used for inverted tag indexes (`tag:dp`, `tag:graph`), difficulty categorizations (`difficulty:easy`), and deduplication sets (`solved:{userId}`). Enables fast multi-tag queries via Redis-native set intersections (`SINTER`).
4. **Sorted Sets / ZSETs (`ZADD`, `ZINCRBY`, `ZREVRANGE`, `ZREVRANK`, `ZSCORE`)**:
   The core engine behind CodeRank's real-time leaderboards (`lb:global`, `lb:contest:{id}`, `lb:college`). Provides $O(\log(N))$ rank retrieval and score updates even with millions of users.
5. **Streams (`XADD`, `XREADGROUP`, `XACK`, `XPENDING`, `XAUTOCLAIM`)**:
   Used as an append-only message log and job queue for grading problem submissions with at-least-once delivery guarantees and consumer groups.
6. **Bitmaps (`SETBIT`, `BITCOUNT`, `GETBIT`)**:
   Extremely memory-efficient tracking of daily coding streaks (366 bits = ~46 bytes per user per year).
7. **HyperLogLog (`PFADD`, `PFCOUNT`, `PFMERGE`)**:
   $O(1)$ memory cardinality counter (~12 KB fixed overhead) for tracking unique daily and weekly visitors with standard error < 0.81%.
8. **Pub/Sub Channels (`PUBLISH`, `SUBSCRIBE`)**:
   Lightweight message bus transmitting real-time score updates to SSE listeners.
9. **Lua Scripts (`EVAL` / `EVALSHA`)**:
   Executes composite operations atomically on the Redis engine thread, eliminating distributed race conditions.
