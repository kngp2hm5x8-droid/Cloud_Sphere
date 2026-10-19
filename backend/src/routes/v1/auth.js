import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../db/pool.js';
import { cookie, createSession, newCsrfToken, requireAuth, requireCsrf } from '../../middleware/auth.js';

const router = Router();
const loginSchema = z.object({ email: z.string().trim().email().max(320), password: z.string().min(1).max(200) });
const publicUser = (u) => ({ user_id: u.user_id, email: u.email, full_name: u.full_name, role: u.role, organization_id: u.organization_id });

router.get('/csrf', (req, res) => {
  const token = newCsrfToken();
  res.setHeader('Set-Cookie', cookie('cloudsphere_csrf', token, { httpOnly: false, maxAge: 28_800 }));
  res.json({ data: { csrf_token: token } });
});
router.post('/login', requireCsrf, async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Enter a valid email and password.' } });
    const { email, password } = parsed.data;
    const { rows } = await query(`SELECT u.user_id, u.email, u.full_name, u.role, u.organization_id
      FROM app_user u LEFT JOIN organization o USING (organization_id)
      WHERE lower(u.email) = lower($1) AND u.is_active AND (u.role = 'admin' OR o.status = 'ACTIVE')
        AND u.password_hash = crypt($2, u.password_hash)`, [email, password]);
    if (!rows[0]) return res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' } });
    await query('UPDATE app_user SET last_login_at = now() WHERE user_id = $1', [rows[0].user_id]);
    res.setHeader('Set-Cookie', cookie('cloudsphere_session', createSession(rows[0].user_id)));
    res.json({ data: publicUser(rows[0]) });
  } catch (error) { next(error); }
});
router.get('/me', requireAuth, (req, res) => res.json({ data: publicUser(req.user) }));
router.post('/logout', requireCsrf, (req, res) => {
  res.setHeader('Set-Cookie', [cookie('cloudsphere_session', '', { maxAge: 0 }), cookie('cloudsphere_csrf', '', { httpOnly: false, maxAge: 0 })]);
  res.json({ data: { logged_out: true } });
});
export default router;
