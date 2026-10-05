import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { createLocalApp } from './browser/local-app.mjs';

export const pilotOwner = { email: 'pilot-owner@example.test', password: 'pilot-only-password-2026' };
export async function startPilot() {
  // Never load a production .env or import the API before validating the DB.
  const connectionString = process.env.DATABASE_URL || 'postgresql://beautyflow_ci:beautyflow_ci_only@127.0.0.1:5432/beautyflow_ci';
  const database = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(database.protocol) ||
      database.hostname !== '127.0.0.1' || database.pathname !== '/beautyflow_ci' ||
      database.search || database.hash) {
    throw new Error('Isolated pilot requires 127.0.0.1/beautyflow_ci');
  }
  const port = Number(process.env.PILOT_PORT ?? 8080);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid pilot port');
  process.env.DATABASE_URL = connectionString;
  process.env.JWT_SECRET = randomBytes(32).toString('hex');
  process.env.PLATFORM_ADMIN_EMAIL = pilotOwner.email;
  process.env.VERCEL = '1';
  delete process.env.CLIENT_ORIGIN; // All browser API calls use the same origin.

  const check = new pg.Pool({ connectionString });
  try {
    const { rows: [identity] } = await check.query("select current_database() as name, current_setting('server_version_num')::int as version");
    if (identity.name !== 'beautyflow_ci' || Math.floor(identity.version / 10000) !== 16) {
      throw new Error('Isolated pilot requires PostgreSQL 16 beautyflow_ci');
    }
  } finally { await check.end(); }
  // These unchanged migrations run only after both connection and server checks.
  const migration = spawn(process.execPath, [fileURLToPath(new URL('../src/migrate.js', import.meta.url))], {
    env: process.env, stdio: ['ignore', 'inherit', 'inherit']
  });
  const [code] = await once(migration, 'exit');
  if (code !== 0) throw new Error('Disposable pilot database initialization failed');

  const { default: app } = await import('../src/index.js');
  const { pool } = await import('../src/database.js');
  const server = createLocalApp(app, { owner: pilotOwner, info: { isolated: true, database: 'beautyflow_ci', postgresMajor: 16 } });
  try {
    server.listen(port, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    const request = async (path, { token, body } = {}) => {
      const response = await fetch(origin + path, {
        method: body ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined
      });
      const value = await response.json();
      if (!response.ok) throw new Error(`Pilot setup failed: ${path} (${response.status})`);
      return value;
    };
    // Reuse the synthetic owner on app restarts while the disposable DB lives.
    const existing = await pool.query('select id from public.app_users where email=$1', [pilotOwner.email]);
    const user = await request(existing.rowCount ? '/api/auth/login' : '/api/auth/register', { body: pilotOwner });
    const businesses = await request('/api/businesses', { token: user.token });
    let business = businesses.find(b => b.name === 'פיילוט מבודד');
    if (!business) {
      business = await request('/api/businesses', { token: user.token, body: { name: 'פיילוט מבודד', businessType: 'סטודיו' } });
      const resource = await request(`/api/businesses/${business.id}/resources`, { token: user.token, body: { name: 'חדר בדיקה', resourceType: 'חדר' } });
      await request(`/api/businesses/${business.id}/services`, { token: user.token, body: { name: 'טיפול בדיקה', price: 120, durationMinutes: 30, resourceIds: [resource.id] } });
    }
    return { server, pool, origin };
  } catch (error) {
    if (server.listening) await new Promise(resolve => server.close(resolve));
    await pool.end();
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const { server, pool, origin } = await startPilot();
    console.log('PILOT_READY ' + JSON.stringify({ url: origin }));
    let stopping = false;
    const stop = async () => {
      if (stopping) return;
      stopping = true;
      server.closeIdleConnections();
      await new Promise(resolve => server.close(resolve));
      await pool.end();
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
