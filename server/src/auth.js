import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { pool } from './database.js';

const keyLength = 64;
const scrypt = (password, salt) => new Promise((resolve, reject) =>
  crypto.scrypt(password, salt, keyLength, (error, hash) => error ? reject(error) : resolve(hash)));

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt);
  return `${salt}:${hash.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  const [salt, expected] = stored.split(':');
  const actual = await scrypt(password, salt);
  return crypto.timingSafeEqual(actual, Buffer.from(expected, 'hex'));
}

export const signToken = (user) => jwt.sign({ sub: user.id, email: user.email, isPlatformAdmin: Boolean(user.is_platform_admin), ver: user.token_version ?? 0 }, process.env.JWT_SECRET, { expiresIn: '7d' });

export async function requireAuth(req, res, next) {
  const token = req.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'נדרשת התחברות' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    const { rows } = await pool.query('select token_version from public.app_users where id = $1', [req.user.sub]);
    if (!rows[0] || (req.user.ver ?? 0) !== rows[0].token_version) return res.status(401).json({ error: 'החיבור פג, יש להתחבר מחדש' });
    next();
  } catch (error) {
    if (error.name !== 'JsonWebTokenError' && error.name !== 'TokenExpiredError' && error.name !== 'NotBeforeError') return next(error);
    res.status(401).json({ error: 'החיבור פג, יש להתחבר מחדש' });
  }
}

