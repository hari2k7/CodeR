-- Atomic Problem Solve & Scoring Script
-- Evaluated atomically by Redis to prevent race conditions & double-scoring.
--
-- ARGV[1]: userId
-- ARGV[2]: problemId
-- ARGV[3]: points (integer)
-- ARGV[4]: contestId (optional, empty string if none)

local userId = ARGV[1]
local problemId = ARGV[2]
local points = tonumber(ARGV[3])
local contestId = ARGV[4]

local solvedKey = "solved:" .. userId
local globalLbKey = "lb:global"
local userKey = "user:" .. userId

-- Step 1: Check if this user has already solved this problem (Redis Set SISMEMBER)
local alreadySolved = redis.call("SISMEMBER", solvedKey, problemId)
if alreadySolved == 1 then
  return 0
end

-- Step 2: Mark problem as solved for this user (Redis Set SADD)
redis.call("SADD", solvedKey, problemId)

-- Step 3: Increment user's score in the global leaderboard (Redis Sorted Set ZINCRBY)
local newScore = redis.call("ZINCRBY", globalLbKey, points, userId)

-- Step 4: Increment user's solved counter in user profile hash (Redis Hash HINCRBY)
redis.call("HINCRBY", userKey, "solved", 1)

-- Step 5: If user belongs to a college, increment college leaderboard (Redis Sorted Set ZINCRBY)
local college = redis.call("HGET", userKey, "college")
if college and college ~= "" and college ~= false then
  redis.call("ZINCRBY", "lb:college", points, college)
end

-- Step 6: If contest ID was passed, increment contest-specific leaderboard
if contestId and contestId ~= "" and contestId ~= "null" then
  redis.call("ZINCRBY", "lb:contest:" .. contestId, points, userId)
end

-- Step 7: Publish live score update to Pub/Sub channel for SSE streaming (Redis PUBLISH)
local username = redis.call("HGET", userKey, "username") or ("user_" .. userId)
local timeRes = redis.call("TIME")
local updatePayload = cjson.encode({
  type = "score_update",
  userId = userId,
  username = username,
  problemId = problemId,
  pointsAdded = points,
  newScore = tonumber(newScore),
  timestamp = tonumber(timeRes[1])
})
redis.call("PUBLISH", "lb:updates", updatePayload)

return tonumber(newScore)
