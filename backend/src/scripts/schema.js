import { redis } from '../redis.js';

async function displaySchema() {
  console.log('\n========================================================================================');
  console.log('                          CODERANK REDIS DATABASE SCHEMA                                ');
  console.log('========================================================================================\n');

  // Query live keys and filter strictly by data structure to avoid WRONGTYPE errors
  const rawUserKeys = await redis.keys('user:*');
  const userKeys = rawUserKeys.filter((k) => /^user:\d+$/.test(k));
  const userHistoryKeys = rawUserKeys.filter((k) => /^user:\d+:history$/.test(k));
  const userFields = userKeys.length > 0
    ? await redis.hkeys(userKeys[0])
    : ['id', 'username', 'email', 'college', 'score', 'solved', 'rating', 'createdAt'];

  const rawProblemKeys = await redis.keys('problem:*');
  const problemKeys = rawProblemKeys.filter((k) => /^problem:\d+$/.test(k));
  const problemFields = problemKeys.length > 0
    ? await redis.hkeys(problemKeys[0])
    : ['id', 'title', 'difficulty', 'points', 'tags', 'statement'];

  const rawSubKeys = await redis.keys('submission:*');
  const subKeys = rawSubKeys.filter((k) => /^submission:\d+$/.test(k));
  const subFields = subKeys.length > 0
    ? await redis.hkeys(subKeys[0])
    : ['id', 'userId', 'problemId', 'status', 'verdict', 'points', 'code', 'submittedAt'];

  const solvedKeys = await redis.keys('solved:*');
  const tagKeys = await redis.keys('tag:*');
  const sessionKeys = await redis.keys('session:*');
  const globalParticipants = await redis.zcard('lb:global');
  const collegeCount = await redis.zcard('lb:college');
  const streamLength = await redis.xlen('submissions').catch(() => 0);
  const totalKeys = await redis.dbsize();

  const schemaTable = [
    {
      'Entity / Key Pattern': 'user:{id}',
      'Redis Type': 'HASH',
      'Live Count': `${userKeys.length} records`,
      'Fields / Attributes (Columns)': userFields.slice(0, 6).join(', ') + '...',
      'TTL Policy': 'Permanent'
    },
    {
      'Entity / Key Pattern': 'user:{id}:history',
      'Redis Type': 'LIST',
      'Live Count': `${userHistoryKeys.length} lists`,
      'Fields / Attributes (Columns)': 'Recent submission IDs [subId_1, subId_2, ...]',
      'TTL Policy': 'Capped (LTRIM 0 49)'
    },
    {
      'Entity / Key Pattern': 'problem:{id}',
      'Redis Type': 'HASH',
      'Live Count': `${problemKeys.length} records`,
      'Fields / Attributes (Columns)': problemFields.slice(0, 6).join(', ') + '...',
      'TTL Policy': 'Permanent'
    },
    {
      'Entity / Key Pattern': 'submission:{id}',
      'Redis Type': 'HASH',
      'Live Count': `${subKeys.length} records`,
      'Fields / Attributes (Columns)': subFields.slice(0, 6).join(', ') + '...',
      'TTL Policy': 'Permanent'
    },
    {
      'Entity / Key Pattern': 'lb:global',
      'Redis Type': 'ZSET (Sorted Set)',
      'Live Count': `${globalParticipants} competitors`,
      'Fields / Attributes (Columns)': 'Member = userId, Score = totalPoints',
      'TTL Policy': 'Permanent'
    },
    {
      'Entity / Key Pattern': 'lb:college',
      'Redis Type': 'ZSET (Sorted Set)',
      'Live Count': `${collegeCount} universities`,
      'Fields / Attributes (Columns)': 'Member = collegeName, Score = aggregatePoints',
      'TTL Policy': 'Permanent'
    },
    {
      'Entity / Key Pattern': 'tag:{name}',
      'Redis Type': 'SET (Inverted Index)',
      'Live Count': `${tagKeys.length} tag sets`,
      'Fields / Attributes (Columns)': 'Members = [problemId_1, problemId_2, ...]',
      'TTL Policy': 'Permanent'
    },
    {
      'Entity / Key Pattern': 'difficulty:{level}',
      'Redis Type': 'SET (Inverted Index)',
      'Live Count': '3 sets (easy, med, hard)',
      'Fields / Attributes (Columns)': 'Members = [problemId_1, problemId_2, ...]',
      'TTL Policy': 'Permanent'
    },
    {
      'Entity / Key Pattern': 'solved:{userId}',
      'Redis Type': 'SET (Anti-Cheat)',
      'Live Count': `${solvedKeys.length} user sets`,
      'Fields / Attributes (Columns)': 'Members = [problemId_A, problemId_B, ...]',
      'TTL Policy': 'Permanent'
    },
    {
      'Entity / Key Pattern': 'submissions',
      'Redis Type': 'STREAM',
      'Live Count': `${streamLength} jobs in queue`,
      'Fields / Attributes (Columns)': 'Message = {subId, problemId, userId, code}',
      'TTL Policy': 'Trimmed (~100k)'
    },
    {
      'Entity / Key Pattern': 'session:{token}',
      'Redis Type': 'HASH',
      'Live Count': `${sessionKeys.length} active sessions`,
      'Fields / Attributes (Columns)': 'userId, username, createdAt, ip',
      'TTL Policy': '1 hour (Sliding)'
    },
    {
      'Entity / Key Pattern': 'otp:{email}',
      'Redis Type': 'STRING',
      'Live Count': 'Dynamic',
      'Fields / Attributes (Columns)': '6-digit cryptographic verification code',
      'TTL Policy': '300s (5 min)'
    },
    {
      'Entity / Key Pattern': 'streak:{userId}:{year}',
      'Redis Type': 'BITMAP',
      'Live Count': 'Per active user',
      'Fields / Attributes (Columns)': 'Bit offset = dayOfYear (1-366), Bit = 0 or 1',
      'TTL Policy': 'Permanent'
    },
    {
      'Entity / Key Pattern': 'visitors:{date}',
      'Redis Type': 'HYPERLOGLOG',
      'Live Count': 'Daily logs',
      'Fields / Attributes (Columns)': 'Cardinality register of unique IP addresses',
      'TTL Policy': 'Permanent'
    }
  ];

  console.table(schemaTable);

  console.log(`\n Total keys stored in Redis DB: ${totalKeys}`);
  console.log(' Persistence: AOF (Append-Only File) + RDB Snapshots enabled');
  console.log(' Primary Datastore: Redis 8.6.7 on localhost:6379\n');

  process.exit(0);
}

displaySchema().catch((err) => {
  console.error('Error generating schema:', err);
  process.exit(1);
});
