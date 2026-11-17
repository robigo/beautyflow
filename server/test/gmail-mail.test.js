import { test } from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
import { resetConfig, sendResetEmail } from '../src/password-reset.js';

const gmail = {
  PASSWORD_RESET_MAIL_PROVIDER: 'gmail',
  GMAIL_USER: ' BeautyFlow.Test@gmail.com ',
  GMAIL_APP_PASSWORD: 'abcd efgh ijkl mnop',
  PASSWORD_RESET_URL: 'https://example.com/reset-password.html'
};
const token = 'a'.repeat(64);
const mail = () => ({ email: 'owner@example.com', token, config: resetConfig(gmail) });

test('Gmail requires explicit selection, complete credentials and an app password', () => {
  const config = resetConfig(gmail);
  assert.equal(config.provider, 'gmail');
  assert.equal(config.user, 'beautyflow.test@gmail.com');
  assert.equal(config.pass, 'abcdefghijklmnop');
  assert.deepEqual(config.from, { name: 'BeautyFlow', address: config.user });
  for (const change of [
    { GMAIL_USER: '' }, { GMAIL_USER: 'not-an-email' },
    { GMAIL_USER: 'sender@gmail.com\r\nBcc: other@example.com' },
    { GMAIL_APP_PASSWORD: '' }, { GMAIL_APP_PASSWORD: 'regular-password' },
    { PASSWORD_RESET_MAIL_PROVIDER: 'unknown' },
    { PASSWORD_RESET_URL: '' }
  ]) assert.throws(() => resetConfig({ ...gmail, ...change }), error => error.statusCode === 503);
});

test('incomplete Gmail settings never fall back to configured Resend', () => {
  assert.throws(() => resetConfig({
    ...gmail, GMAIL_APP_PASSWORD: '', RESEND_API_KEY: 'key', PASSWORD_RESET_FROM: 'sender@example.com'
  }), error => error.statusCode === 503);
  assert.equal(resetConfig({
    PASSWORD_RESET_URL: gmail.PASSWORD_RESET_URL, RESEND_API_KEY: 'key', PASSWORD_RESET_FROM: 'sender@example.com'
  }).provider, 'resend');
});

test('SMTP uses authenticated Gmail over TLS and waits for recipient acceptance', async () => {
  let options, message, accept, closed = false, completed = false;
  const sending = sendResetEmail(mail(), () => assert.fail('Gmail must not use the Resend API'), value => {
    options = value;
    return {
      sendMail(value) { message = value; return new Promise(resolve => { accept = resolve; }); },
      close() { closed = true; }
    };
  }).then(() => { completed = true; });
  await Promise.resolve();
  assert.equal(completed, false);
  assert.equal(closed, false);
  assert.equal(options.host, 'smtp.gmail.com');
  assert.equal(options.port, 465);
  assert.equal(options.secure, true);
  assert.deepEqual(options.auth, { user: 'beautyflow.test@gmail.com', pass: 'abcdefghijklmnop' });
  assert.equal(options.logger, false);
  assert.equal(options.debug, false);
  assert.equal(message.from.address, options.auth.user);
  assert.equal(message.to, 'owner@example.com');
  assert.ok(message.text.includes('#token=' + token));
  assert.ok(!message.text.includes(options.auth.pass));
  accept({ accepted: ['owner@example.com'], rejected: [] });
  await sending;
  assert.equal(completed, true);
  assert.equal(closed, true);
});

test('SMTP rejects delivery errors and closes connections on every outcome', async () => {
  for (const outcome of ['error', 'rejected', 'not-accepted']) {
    let closed = false;
    await assert.rejects(sendResetEmail(mail(), undefined, () => ({
      async sendMail() {
        if (outcome === 'error') throw new Error('SMTP unavailable');
        return outcome === 'rejected' ? { accepted: [], rejected: ['owner@example.com'] } : { accepted: [], rejected: [] };
      },
      close() { closed = true; }
    })));
    assert.equal(closed, true);
  }
});

test('the real Nodemailer composer generates a recovery email without contacting a mail server', async () => {
  let message;
  const composer = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
  await sendResetEmail(mail(), undefined, () => ({
    async sendMail(input) {
      const result = await composer.sendMail(input);
      message = result.message.toString('utf8');
      assert.deepEqual(result.envelope.to, ['owner@example.com']);
      assert.equal(result.envelope.from, 'beautyflow.test@gmail.com');
      return { accepted: result.envelope.to, rejected: [] };
    },
    close() { composer.close(); }
  }));
  assert.match(message, /From: BeautyFlow <beautyflow\.test@gmail\.com>/);
  assert.match(message, /To: owner@example\.com/);
  assert.match(message, /Content-Type: text\/plain; charset=utf-8/);
  assert.ok(message.replace(/=\r?\n/g, '').includes('#token=3D' + token));
});

