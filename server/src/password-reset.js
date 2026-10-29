import crypto from 'node:crypto';

export const resetMessage = 'אם קיים חשבון עם הכתובת הזו, יישלח אליו קישור לאיפוס סיסמה. הקישור תקף ל־30 דקות.';
const invalidLink = () => Object.assign(new Error('הקישור אינו תקין או שפג תוקפו. יש לבקש קישור חדש.'), { statusCode: 400 });
const digest = value => crypto.createHash('sha256').update(value).digest('hex');

export function resetConfig(env = process.env) {
  if (!env.RESEND_API_KEY || !env.PASSWORD_RESET_FROM || !env.PASSWORD_RESET_URL) {
    throw Object.assign(new Error('שירות איפוס הסיסמה אינו זמין כרגע. נסו שוב מאוחר יותר.'), { statusCode: 503 });
  }
  const url = new URL(env.PASSWORD_RESET_URL);
  if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) {
    throw new Error('PASSWORD_RESET_URL must use HTTPS (or localhost for development)');
  }
  url.search = '';
  url.hash = '';
  return { apiKey: env.RESEND_API_KEY, from: env.PASSWORD_RESET_FROM, url };
}

export async function sendResetEmail({ email, token, config }, fetcher = fetch) {
  const url = new URL(config.url);
  url.hash = new URLSearchParams({ token }).toString();
  const response = await fetcher('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + config.apiKey, 'Content-Type': 'application/json', 'Idempotency-Key': 'password-reset/' + digest(token) },
    body: JSON.stringify({
      from: config.from, to: [email], subject: 'איפוס הסיסמה שלך ב־BeautyFlow',
      text: 'להגדרת סיסמה חדשה, פתחו את הקישור הבא:\n' + url.href + '\n\nהקישור חד־פעמי ותקף ל־30 דקות. אם לא ביקשתם איפוס, אפשר להתעלם מההודעה.'
    }),
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error('Password reset mail delivery failed');
}

// Stored in PostgreSQL so limits also apply across serverless instances.
async function allowRequest(pool, key, limit) {
  const result = await pool.query(
    `insert into public.password_reset_limits (key_hash, attempts, window_ends_at)
     values ($1, 1, now() + interval '15 minutes')
     on conflict (key_hash) do update set
       attempts = case when password_reset_limits.window_ends_at <= now() then 1 else password_reset_limits.attempts + 1 end,
       window_ends_at = case when password_reset_limits.window_ends_at <= now() then now() + interval '15 minutes' else password_reset_limits.window_ends_at end
     returning attempts`, [digest(key)]);
  return result.rows[0].attempts <= limit;
}

export function createPasswordResetHandlers({ pool, hashPassword, sendMail = sendResetEmail, env = process.env }) {
  return {
    async forgot(req, res) {
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'יש להזין כתובת אימייל תקינה.' });
      const config = resetConfig(env);
      // Do not trust a client-supplied forwarding header as a rate-limit identity.
      const ipAllowed = await allowRequest(pool, 'ip:' + req.ip, 30);
      if (!ipAllowed) return res.status(429).json({ error: 'נשלחו יותר מדי בקשות. נסו שוב בעוד 15 דקות.' });
      const emailAllowed = await allowRequest(pool, 'email:' + email, 5);
      if (!emailAllowed) return res.json({ message: resetMessage });
      const token = crypto.randomBytes(32).toString('hex'), tokenHash = digest(token);
      const result = await pool.query(
        `update public.app_users set password_reset_token_hash = $2,
         password_reset_expires_at = now() + interval '30 minutes'
         where email = $1 returning id`, [email, tokenHash]);
      if (result.rows.length) {
        try {
          await sendMail({ email, token, config });
        } catch {
          await pool.query('update public.app_users set password_reset_token_hash = null, password_reset_expires_at = null where id = $1 and password_reset_token_hash = $2', [result.rows[0].id, tokenHash]);
          // No recipient, provider response, password, or reset token in logs.
          console.error('Password reset email could not be delivered');
          // Same public response for all addresses, including delivery failures.
        }
      }
      // Only hashed tokens are persisted; prune expired rate-limit identities.
      await pool.query("delete from public.password_reset_limits where window_ends_at < now() - interval '1 day'");
      return res.json({ message: resetMessage });
    },

    async reset(req, res) {
      const { token, password } = req.body ?? {};
      if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw invalidLink();
      if (typeof password !== 'string' || password.length < 8 || password.length > 128) return res.status(400).json({ error: 'הסיסמה חייבת להכיל בין 8 ל־128 תווים.' });
      const tokenHash = digest(token);
      // Check validity before spending time on scrypt. The UPDATE rechecks atomically.
      const valid = await pool.query('select id from public.app_users where password_reset_token_hash = $1 and password_reset_expires_at > now()', [tokenHash]);
      if (!valid.rows.length) throw invalidLink();
      const passwordHash = await hashPassword(password);
      const result = await pool.query(
        `update public.app_users set password_hash = $2,
         password_reset_token_hash = null, password_reset_expires_at = null,
         token_version = token_version + 1
         where password_reset_token_hash = $1 and password_reset_expires_at > now() returning id`, [tokenHash, passwordHash]);
      if (!result.rows.length) throw invalidLink();
      return res.json({ message: 'הסיסמה עודכנה בהצלחה. אפשר להתחבר עם הסיסמה החדשה.' });
    }
  };
}
