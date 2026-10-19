import { Router } from 'express';
import authRouter from './v1/auth.js';
import apiRouter from './v1/api.js';
import { query } from '../db/pool.js';

const router = Router();
router.get('/health', (req, res) => res.json({ data: { status: 'ok' } }));
router.get('/ready', async (req, res, next) => {
  try {
    await query('SELECT 1');
    res.json({ data: { status: 'ready' } });
  } catch (error) { next(error); }
});
router.use('/auth', authRouter);
router.use('/', apiRouter);
export default router;
