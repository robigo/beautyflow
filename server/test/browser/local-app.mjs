import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const root = new URL('../../../', import.meta.url);
const scripts = {
  '/test-supabase.js': new URL('node_modules/@supabase/supabase-js/dist/umd/supabase.js', import.meta.url),
  '/test-chart.js': new URL('node_modules/chart.js/dist/chart.umd.js', import.meta.url)
};
export const pilotPolicy = [
  "default-src 'self'",
  "connect-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "form-action 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'"
].join('; ');

// The same adapter serves automated tests and the isolated manual pilot.
// Rewrites affect HTTP responses only, never the shipped production HTML.
export function createLocalApp(app, { owner, info } = {}) {
  return createServer(async (req, res) => {
    const path = new URL(req.url, 'http://127.0.0.1').pathname;
    if (path.startsWith('/api/')) return app(req, res);
    res.setHeader('Content-Security-Policy', pilotPolicy);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    try {
      if (path.startsWith('/unused-supabase')) return res.writeHead(403).end('Legacy Supabase is disabled in the isolated pilot');
      if (info && path === '/pilot-info') {
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify(info));
      }
      if (scripts[path]) {
        res.setHeader('Content-Type', 'text/javascript');
        return res.end(await readFile(scripts[path]));
      }
      if (['/', '/index.html', '/booking.html', '/admin.html'].includes(path)) {
        let html = await readFile(new URL(path === '/' ? 'index.html' : path.slice(1), root), 'utf8');
        // Relative API addresses also work behind the Codespaces HTTPS proxy.
        html = html.replaceAll('https://beautyflow-ihl7.vercel.app', '')
          .replaceAll('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', '/test-supabase.js')
          .replaceAll('https://cdn.jsdelivr.net/npm/chart.js', '/test-chart.js')
          .replace(/(['"])https:\/\/[a-z0-9]+\.supabase\.co\1/g, "location.origin + '/unused-supabase'");
        if (owner) {
          const values = JSON.stringify(owner).replaceAll('<', '\\u003c');
          html = html.replace('</body>', `<style>body{padding-top:52px!important}.mobilebar{top:52px!important}</style><div id="pilotBanner" dir="rtl" style="position:fixed;top:0;left:0;right:0;z-index:100;background:#fff0c7;color:#553a00;padding:6px;text-align:center;font-size:12px;line-height:18px">סביבת בדיקה בלבד — נתונים זמניים. אין להזין פרטי לקוחות אמיתיים.</div><script>(()=>{const owner=${values};const email=document.querySelector('#ownerEmail'),password=document.querySelector('#ownerPassword');if(email)email.value=owner.email;if(password)password.value=owner.password})();</script></body>`);
        }
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.end(html);
      }
      if (/^\/assets\/[a-zA-Z0-9_.-]+$/.test(path)) return res.end(await readFile(new URL(path.slice(1), root)));
      res.writeHead(404).end();
    } catch (error) {
      console.error(error.message);
      res.writeHead(500).end('Isolated pilot fixture failed');
    }
  });
}
