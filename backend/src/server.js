import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { redis } from './redis.js';
import authRoutes from './routes/auth.js';
import problemsRoutes from './routes/problems.js';
import submissionsRoutes from './routes/submissions.js';
import leaderboardRoutes from './routes/leaderboard.js';
import statsRoutes from './routes/stats.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

// Enable CORS for frontend Vite client
app.use(cors({
  origin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173',
  credentials: true
}));

app.use(express.json());

// HyperLogLog Visitor Tracking Middleware
// Demonstrates Redis HyperLogLog for $O(1)$ memory cardinality estimation of daily unique visitors
app.use((req, res, next) => {
  const today = new Date().toISOString().slice(0, 10);
  const visitorId = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress || '127.0.0.1';
  // Redis command: PFADD key element
  // Adds visitor identifier into today's HyperLogLog sketch
  redis.pfadd(`visitors:${today}`, visitorId).catch(() => {});
  next();
});

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    const pong = await redis.ping();
    res.json({ status: 'ok', redis: pong, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Mount Routes
app.use('/auth', authRoutes);
app.use('/problems', problemsRoutes);
app.use('/submissions', submissionsRoutes);
app.use('/leaderboard', leaderboardRoutes);
app.use('/stats', statsRoutes);

// Fallback 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `Cannot ${req.method} ${req.originalUrl}`
    }
  });
});

// Global standard error handler
app.use((err, req, res, next) => {
  console.error('[Unhandled Error]', err);
  res.status(err.status || 500).json({
    error: {
      code: err.code || 'INTERNAL_SERVER_ERROR',
      message: err.message || 'An unexpected server error occurred.'
    }
  });
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`[CodeRank Server] Running on http://localhost:${PORT}`);
  });
}

export default app;
