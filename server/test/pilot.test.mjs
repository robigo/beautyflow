import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import crypto from 'node:crypto';

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
