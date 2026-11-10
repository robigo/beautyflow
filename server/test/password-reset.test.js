import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createPasswordResetHandlers, resetConfig, resetMessage, sendResetEmail } from '../src/password-reset.js';

const env = { RESEND_API_KEY: 'test-key', PASSWORD_RESET_FROM: 'BeautyFlow <reset@example.com>', PASSWORD_RESET_URL: 'https://example.com/beautyflow/reset-password.html' };
const token = 'a'.repeat(64);
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const response = () => ({ code: 200, body: null, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
const request = body => ({ body, ip: '127.0.0.1' });

test('mail uses the configured URL and a fragment token, never a query token', async () => {
  let sent;
  await sendResetEmail({ email: 'owner@example.com', token, config: resetConfig(env) }, async (url, options) => { sent = { url, options }; return { ok: true }; });
  const body = JSON.parse(sent.options.body);
  assert.equal(sent.url, 'https://api.resend.com/emails');
  assert.deepEqual(body.to, ['owner@example.com']);
  assert.ok(body.text.includes(env.PASSWORD_RESET_URL + '#token=' + token));
  assert.ok(!body.text.includes('?token='));
  assert.ok(!sent.options.headers['Idempotency-Key'].includes(token));
  await assert.rejects(sendResetEmail({ email: 'owner@example.com', token, config: resetConfig(env) }, async () => ({ ok: false })));
});

test('missing mail setup and insecure redirect URLs fail closed', () => {
  assert.throws(() => resetConfig({}), error => error.statusCode === 503);
  assert.throws(() => resetConfig({ ...env, PASSWORD_RESET_URL: 'http://example.com/reset' }));
  assert.throws(() => resetConfig({ ...env, PASSWORD_RESET_URL: 'https://user:pass@example.com/reset' }));
  assert.equal(resetConfig({ ...env, PASSWORD_RESET_URL: 'http://localhost:8080/reset' }).url.protocol, 'http:');
});

test('known and unknown email addresses receive the same public response; only a hash is stored', async () => {
  for (const exists of [true, false]) {
    let sent, saved;
    const pool = { async query(sql, params) {
      if (sql.includes('returning attempts')) return { rows: [{ attempts: 1 }] };
      if (sql.includes('where email = $1')) { saved = params; return { rows: exists ? [{ id: 'user-1' }] : [] }; }
      return { rows: [] };
    } };
    const handlers = createPasswordResetHandlers({ pool, env, sendMail: async item => { sent = item; } });
    const res = response();
    await handlers.forgot(request({ email: ' Owner@Example.com ' }), res);
    assert.deepEqual(res.body, { message: resetMessage });
    assert.equal(saved[0], 'owner@example.com');
    if (exists) { assert.equal(saved[1], digest(sent.token)); assert.notEqual(saved[1], sent.token); }
    else assert.equal(sent, undefined);
  }
});

test('request limits prevent additional email delivery across requests', async () => {
  let sent = 0;
  const pool = { async query(sql) {
    if (sql.includes('returning attempts')) return { rows: [{ attempts: 6 }] };
    if (sql.includes('where email')) assert.fail('rate limited request must not look up a user');
    return { rows: [] };
  } };
  const handlers = createPasswordResetHandlers({ pool, env, sendMail: async () => { sent++; } });
  const res = response();
  await handlers.forgot(request({ email: 'owner@example.com' }), res);
  assert.deepEqual(res.body, { message: resetMessage });
  assert.equal(sent, 0);
});

test('delivery failure clears only the failed token and preserves the public response', async () => {
  const calls = [];
  const pool = { async query(sql, params) {
    calls.push({ sql, params });
    if (sql.includes('returning attempts')) return { rows: [{ attempts: 1 }] };
    return { rows: [{ id: 'user-1' }] };
  } };
  const handlers = createPasswordResetHandlers({ pool, env, sendMail: async () => { throw new Error('provider failed'); } });
  const res = response();
  await handlers.forgot(request({ email: 'owner@example.com' }), res);
  assert.deepEqual(res.body, { message: resetMessage });
  const cleanup = calls.find(call => call.sql.includes('where id = $1 and password_reset_token_hash = $2'));
  assert.ok(cleanup);
  assert.equal(cleanup.params[1].length, 64);
});

test('invalid or expired tokens cannot change a password', async () => {
  let hashed = false;
  const handlers = createPasswordResetHandlers({ pool: { async query() { return { rows: [] }; } }, hashPassword: async () => { hashed = true; } });
  for (const value of ['', 'bad', token]) {
    await assert.rejects(handlers.reset(request({ token: value, password: 'new-password' }), response()), error => error.statusCode === 400);
  }
  assert.equal(hashed, false);
});

test('password validation rejects short and oversized values before database work', async () => {
  const handlers = createPasswordResetHandlers({ pool: { query() { assert.fail('unexpected database call'); } } });
  for (const password of ['short', 'x'.repeat(129), null]) {
    const res = response();
    await handlers.reset(request({ token, password }), res);
    assert.equal(res.code, 400);
  }
});

test('valid reset hashes the new password and atomically consumes the token and invalidates sessions', async () => {
  let update;
  const pool = { async query(sql, params) {
    if (sql.startsWith('select')) return { rows: [{ id: 'user-1' }] };
    update = { sql, params };
    return { rows: [{ id: 'user-1' }] };
  } };
  const handlers = createPasswordResetHandlers({ pool, hashPassword: async password => { assert.equal(password, 'new-password'); return 'salt:hash'; } });
  const res = response();
  await handlers.reset(request({ token, password: 'new-password' }), res);
  assert.equal(res.code, 200);
  assert.deepEqual(update.params, [digest(token), 'salt:hash']);
  assert.match(update.sql, /password_reset_token_hash = null/);
  assert.match(update.sql, /token_version = token_version \+ 1/);
  assert.match(update.sql, /where password_reset_token_hash = \$1 and password_reset_expires_at > now\(\)/);
});

test('a racing or already consumed token fails even if the initial validity check passed', async () => {
  const handlers = createPasswordResetHandlers({
    pool: { async query(sql) { return { rows: sql.startsWith('select') ? [{ id: 'user-1' }] : [] }; } },
    hashPassword: async () => 'salt:hash'
  });
  await assert.rejects(handlers.reset(request({ token, password: 'new-password' }), response()), error => error.statusCode === 400);
});

