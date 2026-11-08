import { cp, mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
export const previewDirectory = fileURLToPath(new URL('../preview-ui/', import.meta.url));

export function assertPreviewDatabase(env = process.env) {
  if (env.VERCEL_ENV !== 'preview') return;
  const url = new URL(env.DATABASE_URL ?? '');
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.pathname !== '/beautyflow_preview' ||
      [...url.searchParams.keys()].some(key => !['sslmode', 'channel_binding'].includes(key))) {
    throw new Error('Preview must use the separate beautyflow_preview database without connection overrides');
  }
}

export async function buildPreviewUI(output = previewDirectory) {
  const root = new URL('../../', import.meta.url);
  await mkdir(resolve(output, 'vendor'), { recursive: true });
  for (const name of ['index.html', 'booking.html', 'reset-password.html']) {
    let html = await readFile(new URL(name, root), 'utf8');
    html = html.replaceAll('https://beautyflow-ihl7.vercel.app', '')
      .replaceAll('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', '/vendor/supabase.js')
      .replaceAll('https://cdn.jsdelivr.net/npm/chart.js', '/vendor/chart.js')
      .replace(/https:\/\/[a-z0-9]+\.supabase\.co/g, 'https://preview-disabled.invalid');
    html = html.replace(/<body([^>]*)>/i, '<body$1><div data-hosted-preview style="padding:12px;background:#fff0bd;text-align:center;font:16px Arial;direction:rtl">BeautyFlow — סביבת בדיקה נפרדת · נתוני בדיקה בלבד</div>');
    if (html.includes('https://beautyflow-ihl7.vercel.app') || /https:\/\/[a-z0-9]+\.supabase\.co/.test(html)) {
      throw new Error('A live API/database address remains in the generated Preview UI');
    }
    await writeFile(resolve(output, name), html, 'utf8');
  }
  await cp(new URL('assets/', root), resolve(output, 'assets'), { recursive: true });
  const chart = resolve(dirname(require.resolve('chart.js')), 'chart.umd.js');
  const supabase = resolve(dirname(require.resolve('@supabase/supabase-js')), '../umd/supabase.js');
  await copyFile(chart, resolve(output, 'vendor/chart.js'));
  await copyFile(supabase, resolve(output, 'vendor/supabase.js'));
}

export function previewUIMiddleware(env = process.env, directory = previewDirectory) {
  return (req, res, next) => {
    if (env.VERCEL_ENV !== 'preview' || !['GET', 'HEAD'].includes(req.method)) return next();
    if (req.path.startsWith('/unused-supabase')) return res.status(410).end();
    const path = req.path === '/' ? '/index.html' : req.path;
    if (!['/index.html', '/booking.html', '/reset-password.html'].includes(path) &&
        !/^\/(assets|vendor)\/[A-Za-z0-9_.-]+$/.test(path)) return next();
    res.set({
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
    });
    res.sendFile(path.slice(1), { root: directory, cacheControl: false }, error => {
      if (error && !res.headersSent) res.status(error.statusCode === 404 ? 404 : 503).end('Preview UI unavailable');
    });
  };
}
