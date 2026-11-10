import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { assertPreviewDatabase, previewUIMiddleware, previewDirectory } from '../src/preview-ui.js';
import { readFile } from 'node:fs/promises';

test('hosted Preview refuses the active database name and connection overrides', () => {
  assert.doesNotThrow(() => assertPreviewDatabase({VERCEL_ENV:'production'}));
  assert.doesNotThrow(() => assertPreviewDatabase({VERCEL_ENV:'preview',DATABASE_URL:'postgresql://user:pass@preview.example/beautyflow_preview?sslmode=require&channel_binding=require'}));
  for (const value of ['postgresql://x:x@host/neondb','postgresql://x:x@host/beautyflow_preview?host=other','postgresql://x:x@host/beautyflow_preview?dbname=neondb']) {
    assert.throws(()=>assertPreviewDatabase({VERCEL_ENV:'preview',DATABASE_URL:value}));
  }
});

test('Preview UI middleware never enables HTML routes in production', async t => {
  const app = express(); app.use(previewUIMiddleware({VERCEL_ENV:'production'}));
  app.use((_req,res)=>res.status(404).end());
  const server=app.listen(0,'127.0.0.1'); await once(server,'listening');
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const root='http://127.0.0.1:'+server.address().port;
  assert.equal((await fetch(root+'/')).status,404);
  assert.equal((await fetch(root+'/reset-password.html')).status,404);
});

test('generated Preview HTML has only same-origin APIs/SDKs and no live Supabase host', async () => {
  for(const name of ['index.html','booking.html','reset-password.html']) {
    const html=await readFile(previewDirectory+name,'utf8');
    assert(!html.includes('https://beautyflow-ihl7.vercel.app'));
    assert(!/https:\/\/[a-z0-9]+\.supabase\.co/.test(html));
    assert(!html.includes('src="https://cdn.jsdelivr.net'));
    assert(html.includes('data-hosted-preview'));
  }
});
