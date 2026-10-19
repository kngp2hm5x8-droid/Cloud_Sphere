import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';
import { query } from '../db/pool.js';

const b64 = (value) => Buffer.from(value).toString('base64url');
const sign = (input) => createHmac('sha256', env.jwtSecret).update(input).digest('base64url');

export function createSession(userId) {
  const header = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64(JSON.stringify({ sub: userId, exp: Math.floor(Date.now() / 1000) + 8 * 60 * 60 }));
  const input = `${header}.${payload}`;
  return `${input}.${sign(input)}`;
}

function verifySession(token) {
  const parts = token?.split('.') ?? [];
  if (parts.length !== 3) return null;
  const expected = Buffer.from(sign(`${parts[0]}.${parts[1]}`));
  const actual = Buffer.from(parts[2]);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    return payload.exp > Date.now() / 1000 ? payload.sub : null;
  } catch { return null; }
}

export function cookie(name, value, { httpOnly = true, maxAge = 28_800 } = {}) {
  return `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Lax; Max-Age=${maxAge}${httpOnly ? '; HttpOnly' : ''}${env.cookieSecure ? '; Secure' : ''}`;
}

export async function requireAuth(req, res, next) {
  try {
    const userId = verifySession(req.cookies?.cloudsphere_session);
    if (!userId) return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in is required.' } });
    const { rows } = await query(`SELECT u.user_id, u.email, u.full_name, u.role, u.organization_id
      FROM app_user u LEFT JOIN organization o USING (organization_id)
      WHERE u.user_id = $1 AND u.is_active AND (u.role = 'admin' OR o.status = 'ACTIVE')`, [userId]);
    if (!rows[0]) return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in is required.' } });
    req.user = rows[0];
    next();
  } catch (error) { next(error); }
}

export function requireRole(role) {
  return (req, res, next) => req.user?.role === role ? next() : res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You do not have access to this resource.' } });
}

export function requireCsrf(req, res, next) {
  const cookieToken = req.cookies?.cloudsphere_csrf ?? '';
  const headerToken = req.get('X-CSRF-Token') ?? '';
  const marker = req.get('X-Requested-With');
  const a = Buffer.from(cookieToken);
  const b = Buffer.from(headerToken);
  if (marker !== 'CloudSphere' || !a.length || a.length !== b.length || !timingSafeEqual(a, b)) {
    return res.status(403).json({ error: { code: 'CSRF_INVALID', message: 'Refresh the page and try again.' } });
  }
  next();
}

export function newCsrfToken() { return randomBytes(32).toString('base64url'); }
