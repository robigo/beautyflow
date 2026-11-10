// Development-only matched UI/API with a synthetic mailbox. Never deployed by Vercel.
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

export async function assertPilotDatabase(connectionString = process.env.DATABASE_URL) {
  const url = new URL(connectionString ?? '');
  if (url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' ||
      url.pathname !== '/beautyflow_ci' || url.username !== 'beautyflow_ci' || url.search || url.hash) {
    throw new Error('Local pilot requires 127.0.0.1/beautyflow_ci as beautyflow_ci, without URL overrides');
  }
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    const { rows: [identity] } = await client.query("select current_database() as db, current_user as role, current_setting('server_version_num')::int as version");
    if (identity.db !== 'beautyflow_ci' || identity.role !== 'beautyflow_ci' || identity.version < 160000 || identity.version >= 170000) {
      throw new Error('Local pilot database identity/version is not the disposable PostgreSQL 16 target');
    }
  } finally { await client.end(); }
}

export async function startLocalPilot({ port = 18080 } = {}) {
  if (process.env.RESEND_API_KEY && process.env.RESEND_API_KEY !== 'LOCAL-CAPTURE-NOT-A-REAL-KEY') {
    throw new Error('Refusing to start the local capture pilot with a real mail credential');
  }
  if (!process.env.JWT_SECRET) throw new Error('Set a disposable JWT_SECRET');
  await assertPilotDatabase();
  process.env.VERCEL = '1';
  const { default: app } = await import('../src/index.js');
  const { pool } = await import('../src/database.js');
  const repository = new URL('../../', import.meta.url);
  const sdk = {
    '/pilot/supabase.js': new URL('browser/node_modules/@supabase/supabase-js/dist/umd/supabase.js', import.meta.url),
    '/pilot/chart.js': new URL('browser/node_modules/chart.js/dist/chart.umd.js', import.meta.url)
  };
  const messages = [], originalFetch = globalThis.fetch;
  let origin;
  globalThis.fetch = async (input, options) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.href === 'https://api.resend.com/emails') {
      const message = JSON.parse(options.body);
      if (!Array.isArray(message.to) || message.to.some(email => !email.endsWith('@example.test'))) {
        throw new Error('Pilot mailbox accepts synthetic example.test recipients only');
      }
      const link = message.text.match(/http:\/\/127\.0\.0\.1:\d+\/reset-password\.html#token=[a-f0-9]{64}/)?.[0];
      if (!link || new URL(link).origin !== origin) throw new Error('Reset link escaped the local pilot');
      messages.unshift({ id: randomUUID(), to: message.to, subject: message.subject, link, capturedAt: new Date().toISOString() });
      messages.splice(100);
      return new Response('{}', { status: 200 });
    }
    if (url.origin !== origin || url.pathname.startsWith('/unused-supabase')) throw new Error('External requests are blocked in the local pilot');
    return originalFetch(input, options);
  };
  const inbox = `<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BeautyFlow — תיבת בדיקה</title><style>body{font:18px Arial;max-width:800px;margin:30px auto;padding:18px}article{border:1px solid #ccc;border-radius:12px;padding:18px;margin:16px 0}a{overflow-wrap:anywhere}</style><h1>תיבת מייל מדומה</h1><p>סביבה מקומית עם נתונים מלאכותיים. לא נשלח מייל אמיתי.</p><a href="/">חזרה לפיילוט</a><button onclick="location.reload()">רענן</button><main></main><script>fetch('/pilot/inbox.json').then(r=>r.json()).then(items=>{for(const item of items){const box=document.createElement('article'),p=document.createElement('p'),a=document.createElement('a');p.textContent=item.to.join(', ')+' · '+item.subject;a.href=item.link;a.textContent='פתיחת קישור שחזור לבדיקה';box.append(p,a);document.querySelector('main').append(box)}})</script></html>`;
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://127.0.0.1').pathname;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.headers.host !== new URL(origin).host) { res.writeHead(403).end(); return; }
    if (path.startsWith('/unused-supabase')) { res.writeHead(410).end('Legacy Supabase disabled in the pilot'); return; }
    if (path.startsWith('/api/')) return app(req, res);
    try {
      if (path === '/pilot/inbox.json') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(messages)); return; }
      if (path === '/pilot/inbox') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(inbox); return; }
      if (sdk[path]) { res.setHeader('Content-Type', 'text/javascript'); res.end(await readFile(sdk[path])); return; }
      if (['/', '/index.html', '/booking.html', '/reset-password.html'].includes(path)) {
        let html = await readFile(new URL(path === '/' ? 'index.html' : path.slice(1), repository), 'utf8');
        html = html.replaceAll('https://beautyflow-ihl7.vercel.app', origin)
          .replaceAll('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', '/pilot/supabase.js')
          .replaceAll('https://cdn.jsdelivr.net/npm/chart.js', '/pilot/chart.js')
          .replace(/https:\/\/[a-z0-9]+\.supabase\.co/g, origin + '/unused-supabase');
        const banner = '<div data-local-pilot style="padding:14px;background:#fff0bd;text-align:center;font:16px Arial;direction:rtl">פיילוט מקומי — נתונים מלאכותיים · לא נשלחים מיילים אמיתיים · <a href="/pilot/inbox">תיבת מייל לבדיקה</a></div>';
        html = html.replace(/<body([^>]*)>/i, '<body$1>' + banner);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Content-Security-Policy', "connect-src 'self'; form-action 'self'; frame-ancestors 'none'");
        res.end(html); return;
      }
      if (/^\/assets\/[a-zA-Z0-9_.-]+$/.test(path)) {
        res.setHeader('Content-Type', path.endsWith('.css') ? 'text/css' : path.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
        res.end(await readFile(new URL(path.slice(1), repository))); return;
      }
      res.writeHead(404).end();
    } catch { res.writeHead(500).end('Local pilot fixture failed'); }
  });
  try {
    server.listen(port, '127.0.0.1'); await once(server, 'listening');
    origin = `http://127.0.0.1:${server.address().port}`;
    process.env.CLIENT_ORIGIN = origin;
    process.env.RESEND_API_KEY = 'LOCAL-CAPTURE-NOT-A-REAL-KEY';
    process.env.PASSWORD_RESET_FROM = 'BeautyFlow Pilot <reset@example.test>';
    process.env.PASSWORD_RESET_URL = origin + '/reset-password.html';
  } catch (error) { globalThis.fetch = originalFetch; await pool.end(); throw error; }
  return { origin, messages, pool, close: async () => {
    await new Promise(resolve => server.close(resolve));
    globalThis.fetch = originalFetch; await pool.end();
  } };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await assertPilotDatabase();
  if (process.argv.includes('--migrate-only')) {
    await import('../src/migrate.js');
  } else {
    const pilot = await startLocalPilot();
    console.log('BeautyFlow local pilot: ' + pilot.origin);
    console.log('Synthetic mailbox: ' + pilot.origin + '/pilot/inbox');
    console.log('No real email is sent. Register an example.test account to try the pilot.');
    process.on('SIGINT', async () => { await pilot.close(); process.exit(0); });
    process.on('SIGTERM', async () => { await pilot.close(); process.exit(0); });
  }
}
