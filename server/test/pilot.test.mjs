import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import crypto from 'node:crypto';
import { once } from 'node:events';

// Refuse to send test requests to a live server or a non-test database.
const database = new URL(process.env.DATABASE_URL ?? '');
if (!['127.0.0.1', 'localhost'].includes(database.hostname) || database.pathname !== '/beautyflow_ci') {
  throw new Error('Pilot tests require a local beautyflow_ci database');
}
if (!process.env.JWT_SECRET) throw new Error('Set a disposable JWT_SECRET for the test run');
process.env.VERCEL = '1'; // Import the Express app without opening its default port.
const { default: app } = await import('../src/index.js');
const { pool } = await import('../src/database.js');
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
after(async () => { await new Promise(resolve => server.close(resolve)); await pool.end(); });

async function request(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const value = response.status === 204 ? null : await response.json();
  return { status: response.status, value };
}
async function expectStatus(path, options, status) {
  const result = await request(path, options);
  assert.equal(result.status, status, `${options?.method ?? 'GET'} ${path}: ${JSON.stringify(result.value)}`);
  return result.value;
}

test('pilot flows: identity, tenant access and public booking', async () => {
  const suffix = crypto.randomUUID();
  await expectStatus('/api/health', {}, 200);
  const userA = await expectStatus('/api/auth/register', { method: 'POST', body: { email: `pilot-a-${suffix}@example.test`, password: 'test-only-password-123' } }, 201);
  const userB = await expectStatus('/api/auth/register', { method: 'POST', body: { email: `pilot-b-${suffix}@example.test`, password: 'test-only-password-123' } }, 201);
  const a = userA.token, b = userB.token;
  assert.ok(a && b);
  const businessA = await expectStatus('/api/businesses', { token: a, method: 'POST', body: { name: 'Pilot A', businessType: 'Studio' } }, 201);
  const businessB = await expectStatus('/api/businesses', { token: b, method: 'POST', body: { name: 'Pilot B', businessType: 'Studio' } }, 201);
  assert.notEqual(businessA.id, businessB.id);
  assert.deepEqual((await expectStatus('/api/businesses', { token: a }, 200)).map(item => item.id), [businessA.id]);
  await expectStatus(`/api/businesses/${businessB.id}/workspace`, { token: a }, 404);
  await expectStatus(`/api/businesses/${businessB.id}/resources`, { token: a, method: 'POST', body: { name: 'Intruder' } }, 404);

  const resource = await expectStatus(`/api/businesses/${businessA.id}/resources`, { token: a, method: 'POST', body: { name: 'Pilot Room', resourceType: 'Room' } }, 201);
  const service = await expectStatus(`/api/businesses/${businessA.id}/services`, { token: a, method: 'POST', body: { name: 'Pilot Session', price: 10, durationMinutes: 30, resourceIds: [resource.id] } }, 201);
  const publicPath = `/api/public/businesses/${businessA.publicId}`;
  const publicBusiness = await expectStatus(publicPath, {}, 200);
  assert.equal(publicBusiness.name, 'Pilot A');
  assert.equal(publicBusiness.services[0].id, service.id);
  const privateWorkspace = await expectStatus(`/api/businesses/${businessA.id}/workspace`, { token: a }, 200);
  assert.equal(privateWorkspace.services[0].id, service.id);

  let chosen;
  for (let day = 2; day < 12 && !chosen; day++) {
    const date = new Date(Date.now() + day * 86_400_000).toISOString().slice(0, 10);
    const availability = await expectStatus(`${publicPath}/availability?serviceId=${service.id}&resourceId=${resource.id}&date=${date}`, {}, 200);
    chosen = availability.slots[0];
  }
  assert.ok(chosen, 'No future appointment slot found in next 12 days');
  const appointment = { customerName: 'Pilot Customer', phone: '0500000000', serviceId: service.id, resourceId: resource.id, startsAt: chosen };
  const booked = await expectStatus(`${publicPath}/appointments`, { method: 'POST', body: appointment }, 201);
  assert.ok(booked.id);
  await expectStatus(`${publicPath}/appointments`, { method: 'POST', body: appointment }, 409);
  await expectStatus(`/api/businesses/${businessA.id}/appointments/${booked.id}`, { token: b, method: 'PATCH', body: { status: 'בוטל' } }, 404);
  await expectStatus(`/api/businesses/${businessA.id}/appointments/${booked.id}`, { token: a, method: 'PATCH', body: { status: 'בוטל' } }, 200);
  await expectStatus(`${publicPath}/appointments`, { method: 'POST', body: appointment }, 201);
  const aWorkspace = await expectStatus(`/api/businesses/${businessA.id}/workspace`, { token: a }, 200);
  const bWorkspace = await expectStatus(`/api/businesses/${businessB.id}/workspace`, { token: b }, 200);
  assert.ok(aWorkspace.appointments.length >= 2);
  assert.equal(bWorkspace.appointments.length, 0);
  assert.equal(bWorkspace.customers.length, 0);
});


test('password reset with real local PostgreSQL: delivery, expiry, replay and session revocation', async t => {
  const originalFetch = globalThis.fetch;
  const previous = Object.fromEntries(['RESEND_API_KEY', 'PASSWORD_RESET_FROM', 'PASSWORD_RESET_URL'].map(key => [key, process.env[key]]));
  process.env.RESEND_API_KEY = 'disposable-test-mail-key';
  process.env.PASSWORD_RESET_FROM = 'BeautyFlow <reset@example.test>';
  process.env.PASSWORD_RESET_URL = 'https://example.test/reset-password.html';
  let deliveredToken, deliveries = 0;
  globalThis.fetch = async (url, options) => {
    if (String(url) === 'https://api.resend.com/emails') {
      const message = JSON.parse(options.body);
      const link = message.text.match(/https:\/\/example\.test\/reset-password\.html#token=([a-f0-9]{64})/);
      assert.ok(link);
      deliveredToken = link[1];
      deliveries++;
      return new Response('{}', { status: 200 });
    }
    assert.ok(String(url).startsWith(base + '/'), 'No external test requests allowed');
    return originalFetch(url, options);
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const email = `reset-${crypto.randomUUID()}@example.test`;
  const password = 'old-test-password-123', replacement = 'new-test-password-456';
  const registered = await expectStatus('/api/auth/register', { method: 'POST', body: { email, password } }, 201);
  const post = (path, body, status) => expectStatus(path, { method: 'POST', body }, status);
  const known = await post('/api/auth/forgot-password', { email }, 200);
  const first = deliveredToken;
  const unknown = await post('/api/auth/forgot-password', { email: `absent-${crypto.randomUUID()}@example.test` }, 200);
  assert.deepEqual(known, unknown);
  assert.equal(deliveries, 1);
  const stored = (await pool.query('select password_reset_token_hash, password_reset_expires_at from public.app_users where email = $1', [email])).rows[0];
  assert.equal(stored.password_reset_token_hash, crypto.createHash('sha256').update(first).digest('hex'));
  assert.ok(stored.password_reset_expires_at > new Date());
  await post('/api/auth/forgot-password', { email }, 200);
  const second = deliveredToken;
  assert.notEqual(second, first);
  await post('/api/auth/reset-password', { token: first, password: replacement }, 400);
  await pool.query("update public.app_users set password_reset_expires_at = now() - interval '1 minute' where email = $1", [email]);
  await post('/api/auth/reset-password', { token: second, password: replacement }, 400);
  await post('/api/auth/forgot-password', { email }, 200);
  const current = deliveredToken;
  await post('/api/auth/reset-password', { token: current, password: replacement }, 200);
  await post('/api/auth/reset-password', { token: current, password: replacement }, 400);
  await expectStatus('/api/businesses', { token: registered.token }, 401);
  await post('/api/auth/login', { email, password }, 401);
  const login = await post('/api/auth/login', { email, password: replacement }, 200);
  assert.deepEqual(await expectStatus('/api/businesses', { token: login.token }, 200), []);
});
