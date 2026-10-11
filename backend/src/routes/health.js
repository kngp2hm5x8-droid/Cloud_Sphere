import { Router } from 'express';
import { query } from '../db/pool.js';

const router = Router();

router.get('/', (req, res) => {
  res.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
});

// Development convenience: also reports DB/server versions (restrict or remove before any real deployment).
router.get('/db', async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT current_database() AS database, version() AS version, now() AS server_time'
    );
    res.json({ status: 'ok', ...rows[0] });
  } catch (err) {
    console.error('Database health check failed:', err.message);
    const wrapped = new Error('Database unavailable');
    wrapped.status = 503;
    wrapped.code = 'DB_UNAVAILABLE';
    next(wrapped);
  }
});

export default router;
