import { Router } from 'express';
import { query } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.get('/', (req, res) => {
  res.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
});

router.get('/db', requireAuth, async (req, res, next) => {
  try {
    await query('SELECT 1');
    res.json({ status: 'ok' });
  } catch (err) {
    const wrapped = new Error('Database unavailable');
    wrapped.status = 503;
    wrapped.code = 'DB_UNAVAILABLE';
    next(wrapped);
  }
});

export default router;
