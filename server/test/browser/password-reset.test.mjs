import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const origin = 'https://reset-ui.example.test';
const html = await readFile(new URL('../../../reset-password.html', import.meta.url), 'utf8');
const token = 'b'.repeat(64);

test('reset UI: requests, errors, fragment privacy, password confirmation and mobile layout', async t => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, serviceWorkers: 'block' });
  const calls = [];
  let status = 200, result = { message: 'בדקו את תיבת הדואר' };
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin === origin) return route.fulfill({ status: 200, contentType: 'text/html', body: html });
    if (url.origin === 'https://beautyflow-ihl7.vercel.app' && url.pathname.startsWith('/api/auth/')) {
      calls.push({ path: url.pathname, body: req.postDataJSON() });
      return route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': origin }, body: JSON.stringify(result) });
    }
    throw new Error('Unexpected external request');
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/reset-password.html');
  await page.fill('#email', 'owner@example.test');
  await page.click('#forgotForm button');
  await page.waitForFunction(() => document.querySelector('#status').textContent === 'בדקו את תיבת הדואר');
  assert.equal(calls[0].path, '/api/auth/forgot-password');
  assert.equal(calls[0].body.email, 'owner@example.test');
  status = 503; result = { error: 'שירות האיפוס אינו זמין' };
  await page.click('#forgotForm button');
  await page.waitForFunction(() => document.querySelector('#status').classList.contains('error'));
  assert.match(await page.textContent('#status'), /אינו זמין/);
  await page.goto(origin + '/reset-password.html#token=' + token);
  assert.equal(new URL(page.url()).hash, '');
  assert.ok(await page.isVisible('#resetForm'));
  await page.fill('#password', 'new-password-123');
  await page.fill('#confirm', 'different-password');
  const before = calls.length;
  await page.click('#resetForm button');
  assert.equal(calls.length, before);
  assert.equal(await page.locator('#confirm').evaluate(el => el.validity.customError), true);
  await page.fill('#confirm', 'new-password-123');
  status = 200; result = { message: 'הסיסמה עודכנה בהצלחה' };
  await page.click('#resetForm button');
  await page.waitForFunction(() => document.querySelector('#resetForm').classList.contains('hidden'));
  assert.deepEqual(calls.at(-1).body, { token, password: 'new-password-123' });
  assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
  await page.goto(origin + '/reset-password.html#token=' + token);
  status = 400; result = { error: 'expired' };
  await page.fill('#password', 'new-password-123');
  await page.fill('#confirm', 'new-password-123');
  await page.click('#resetForm button');
  await page.waitForFunction(() => !document.querySelector('#requestAgain').classList.contains('hidden'));
  assert.ok(!(await page.isVisible('#resetForm')));
  await page.goto(origin + '/reset-password.html#token=malformed');
  assert.equal(new URL(page.url()).hash, '');
  assert.ok(await page.isVisible('#requestAgain'));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
});
