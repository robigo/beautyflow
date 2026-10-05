import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';

// Check before importing the app: importing it opens a database pool.
const database = new URL(process.env.DATABASE_URL ?? '');
if (database.hostname !== '127.0.0.1' || database.pathname !== '/beautyflow_ci') {
  throw new Error('Browser tests require 127.0.0.1/beautyflow_ci');
}
if (!process.env.JWT_SECRET) throw new Error('Set a disposable JWT_SECRET');
process.env.VERCEL = '1';
const { default: app } = await import('../../src/index.js');
const { pool } = await import('../../src/database.js');
const root = new URL('../../../', import.meta.url);
const scripts = {
  '/test-supabase.js': new URL('node_modules/@supabase/supabase-js/dist/umd/supabase.js', import.meta.url),
  '/test-chart.js': new URL('node_modules/chart.js/dist/chart.umd.js', import.meta.url)
};
let origin, browser;
// Rewrite addresses in the test response only; the shipped HTML is unchanged.
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://127.0.0.1').pathname;
  if (path.startsWith('/api/')) return app(req, res);
  try {
    if (scripts[path]) {
      res.setHeader('Content-Type', 'text/javascript');
      return res.end(await readFile(scripts[path]));
    }
    if (path === '/' || path === '/index.html' || path === '/booking.html') {
      let html = await readFile(new URL(path === '/booking.html' ? 'booking.html' : 'index.html', root), 'utf8');
      html = html.replaceAll('https://beautyflow-ihl7.vercel.app', origin)
        .replaceAll('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', '/test-supabase.js')
        .replaceAll('https://cdn.jsdelivr.net/npm/chart.js', '/test-chart.js')
        .replace(/https:\/\/[a-z0-9]+\.supabase\.co/g, origin + '/unused-supabase');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.end(html);
    }
    if (/^\/assets\/[a-zA-Z0-9_.-]+$/.test(path)) return res.end(await readFile(new URL(path.slice(1), root)));
    res.writeHead(404).end();
  } catch (error) {
    console.error(error.message);
    res.writeHead(500).end('Test fixture failed');
  }
});
before(async () => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  if (server.listening) await new Promise(resolve => server.close(resolve));
  await pool.end();
});

async function api(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(origin + path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const value = await response.json();
  assert.ok(response.ok, `${method} ${path}: ${JSON.stringify(value)}`);
  return value;
}
async function fixture() {
  const email = `browser-${randomUUID()}@example.test`, password = 'disposable-browser-password';
  const user = await api('/api/auth/register', { method: 'POST', body: { email, password } });
  const business = await api('/api/businesses', { token: user.token, method: 'POST', body: { name: 'Browser pilot', businessType: 'סטודיו' } });
  const resource = await api(`/api/businesses/${business.id}/resources`, { token: user.token, method: 'POST', body: { name: 'Test room', resourceType: 'Room' } });
  return { email, password, token: user.token, business, resource };
}
async function isolatedPage(t) {
  const context = await browser.newContext({ timezoneId: 'Asia/Jerusalem', serviceWorkers: 'block', viewport: { width: 1440, height: 1000 } });
  const blocked = [], errors = [];
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin || url.pathname.startsWith('/unused-supabase')) {
      blocked.push(url.origin + url.pathname); // Do not log credentials or query strings.
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  t.after(async () => {
    try {
      assert.deepEqual(blocked, [], 'The UI attempted an unexpected network request');
      assert.deepEqual(errors, [], 'Browser JavaScript errors');
    } finally { await context.close(); }
  });
  return page;
}
async function visible(page, selector) {
  await page.locator(selector).waitFor({ state: 'visible' });
}
async function login(page, f) {
  await page.locator('#ownerEmail').fill(f.email);
  await page.locator('#ownerPassword').fill(f.password);
  await page.locator('#ownerAuthSubmit').click();
  await visible(page, '#workspacePicker');
  await page.locator('#businessSelect').selectOption(f.business.id);
  await page.locator('#enterBusiness').click();
  await page.locator('#authGate').waitFor({ state: 'hidden' });
}
async function textContains(page, selector, text) {
  await page.waitForFunction(({ selector, text }) => document.querySelector(selector)?.textContent.includes(text), { selector, text });
}
async function servicePrice(page) {
  await page.locator('[data-screen="settings"]').click();
  await textContains(page, '#serviceList', 'Pilot price');
  assert.match(await page.locator('#serviceList').innerText(), /120/);
}
async function appointmentPrices(page) {
  await page.locator('[data-screen="calendar"]').click();
  for (const [name, price] of [['Paid pilot', '135'], ['Free pilot', '0']]) {
    const row = page.locator('#calendarRows tr').filter({ hasText: name });
    await row.waitFor({ state: 'visible' });
    assert.match(await row.locator('td').nth(3).innerText(), new RegExp(`^₪\\s*${price}$`));
  }
}
async function restored(page) {
  await page.waitForFunction(() =>
    !document.documentElement.classList.contains('restoring-session') &&
    document.querySelector('#authGate').classList.contains('hide'));
  await visible(page, '#dashboard.active');
}
async function diagnostics(page, operation) {
  try { await operation(); }
  catch (error) {
    await mkdir(new URL('artifacts/', import.meta.url), { recursive: true });
    await page.screenshot({ path: new URL('artifacts/failure.png', import.meta.url).pathname, fullPage: true });
    throw error;
  }
}

test('owner UI persists service and appointment prices through reload and a fresh login', { timeout: 120000 }, async t => {
  const f = await fixture(), page = await isolatedPage(t);
  await diagnostics(page, async () => {
    await page.goto(origin);
    await login(page, f);
    await page.locator('[data-screen="settings"]').click();
    await page.locator('#serviceName').fill('Pilot price');
    await page.locator('#servicePrice').fill('120');
    await page.locator('#serviceDuration').fill('30');
    await page.locator('#serviceResource').selectOption(f.resource.id);
    const saved = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/services'));
    await page.locator('#serviceForm button').click();
    assert.equal((await saved).status(), 201);
    await servicePrice(page);
    const date = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    for (const [name, price, time] of [['Paid pilot', '135', '10:00'], ['Free pilot', '0', '11:00']]) {
      // Cover both a fresh login and the session-restoration submit handler.
      if (name === 'Free pilot') {
        await page.reload();
        await restored(page);
      }
      await page.locator('[data-screen="book"]').click();
      await page.locator('#bookName').fill(name);
      await page.locator('#bookPhone').fill(name === 'Paid pilot' ? '0500000001' : '0500000002');
      await page.locator('#bookTreatment').selectOption({ label: 'Pilot price' });
      await page.locator('#bookResource').selectOption(f.resource.id);
      await page.locator('#bookPrice').fill(price);
      await page.locator('#bookDate').fill(date);
      await page.locator('#bookTime').fill(time);
      const saved = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/appointments'));
      await page.locator('#appointmentForm button').click();
      assert.equal((await saved).status(), 201);
      await visible(page, '#calendar.active');
    }
    const checkDatabase = async () => {
      const workspace = await api(`/api/businesses/${f.business.id}/workspace`, { token: f.token });
      assert.equal(Number(workspace.services.find(s => s.name === 'Pilot price').price), 120);
      for (const [name, price] of [['Paid pilot', 135], ['Free pilot', 0]]) {
        assert.equal(Number(workspace.appointments.find(a => a.customer_name === name)?.price), price, name);
      }
    };
    await checkDatabase();
    await appointmentPrices(page);
    await page.reload();
    await restored(page);
    await servicePrice(page);
    await appointmentPrices(page);
    await page.locator('#logoutButton').click();
    await visible(page, '#ownerAuth');
    assert.equal(await page.evaluate(() => localStorage.getItem('beautyflow-api-token-v1')), null);
    // Clear cached business data, so the next login must read prices from PostgreSQL.
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await login(page, f);
    await servicePrice(page);
    await appointmentPrices(page);
    await checkDatabase();
  });
});

test('public booking displays the service price and stores it on the appointment', { timeout: 60000 }, async t => {
  const f = await fixture();
  const service = await api(`/api/businesses/${f.business.id}/services`, { token: f.token, method: 'POST', body: { name: 'Public pilot', price: 120, durationMinutes: 30, resourceIds: [f.resource.id] } });
  let date;
  for (let day = 2; day < 12 && !date; day++) {
    const candidate = new Date(Date.now() + day * 86400000).toISOString().slice(0, 10);
    const availability = await api(`/api/public/businesses/${f.business.publicId}/availability?serviceId=${service.id}&resourceId=${f.resource.id}&date=${candidate}`);
    if (availability.slots.length) date = candidate;
  }
  assert.ok(date, 'No future public booking slot');
  const page = await isolatedPage(t);
  await diagnostics(page, async () => {
    await page.goto(`${origin}/booking.html?business=${f.business.publicId}`);
    await visible(page, '#bookingForm');
    assert.match(await page.locator('#service').innerText(), /Public pilot.*120/);
    await page.locator('#name').fill('Public customer');
    await page.locator('#phone').fill('0500000003');
    await page.locator('#date').fill(date);
    await page.locator('#date').dispatchEvent('change');
    await page.waitForFunction(() => !document.querySelector('#time').disabled);
    await page.locator('#submit').click();
    await visible(page, '#notice.success');
    const workspace = await api(`/api/businesses/${f.business.id}/workspace`, { token: f.token });
    const appointment = workspace.appointments.find(a => a.customer_name === 'Public customer');
    assert.ok(appointment);
    assert.equal(Number(appointment.price), 120);
    assert.equal(appointment.service_id, service.id);
  });
});
