import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { startLocalPilot } from '../local-pilot.mjs';

test('matched local UI/API: captured reset link changes password and revokes the old session', {timeout:60000}, async t => {
  const pilot = await startLocalPilot({port:0});
  t.after(()=>pilot.close());
  const browser = await chromium.launch({executablePath:process.env.BEAUTYFLOW_TEST_BROWSER || undefined});
  t.after(()=>browser.close());
  const context = await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
  const blocked = [], errors = [];
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== pilot.origin || url.pathname.startsWith('/unused-supabase')) {
      blocked.push(url.origin + url.pathname); return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage(); page.on('pageerror', e=>errors.push(e.message));
  const email = `reset-${randomUUID()}@example.test`, password = 'old-pilot-password', replacement='new-pilot-password';
  const registered = await fetch(pilot.origin+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});
  assert.equal(registered.status,201); const oldSession = await registered.json();
  await page.goto(pilot.origin+'/reset-password.html');
  assert(await page.locator('[data-local-pilot]').isVisible());
  await page.locator('#email').fill(email);
  await page.locator('#forgotForm button').click();
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('אם קיים חשבון'));
  assert.equal(pilot.messages.length,1);
  // Navigate via the same inbox a human can inspect; no mocked API responses.
  await page.goto(pilot.origin+'/pilot/inbox');
  const link = await page.locator('main article a').getAttribute('href');
  await page.locator('main article a').click();
  await page.locator('#resetForm').waitFor({state:'visible'});
  assert.equal(new URL(page.url()).hash,'');
  await page.locator('#password').fill(replacement);
  await page.locator('#confirm').fill(replacement);
  await page.locator('#resetForm button').click();
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('הסיסמה עודכנה'));
  const api = (path,body,token)=>fetch(pilot.origin+path,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});
  assert.equal((await api('/api/businesses',null,oldSession.token)).status,401);
  assert.equal((await api('/api/auth/login',{email,password})).status,401);
  const login = await api('/api/auth/login',{email,password:replacement});
  assert.equal(login.status,200);
  assert.equal((await api('/api/businesses',null,(await login.json()).token)).status,200);
  assert.equal((await api('/api/auth/reset-password',{token:new URLSearchParams(new URL(link).hash.slice(1)).get('token'),password:replacement})).status,400);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual(blocked,[]); assert.deepEqual(errors,[]);
});
