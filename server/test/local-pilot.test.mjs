import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertPilotDatabase, startLocalPilot} from './local-pilot.mjs';

test('local pilot rejects hosted, wrong-name, wrong-role and option-overridden database targets before connecting', async () => {
  for (const url of [
    'postgresql://beautyflow_ci:x@host.neon.tech/beautyflow_ci',
    'postgresql://beautyflow_ci:x@127.0.0.1/production',
    'postgresql://postgres:x@127.0.0.1/beautyflow_ci',
    'postgresql://beautyflow_ci:x@127.0.0.1/beautyflow_ci?host=host.neon.tech',
    'postgresql://beautyflow_ci:x@127.0.0.1/beautyflow_ci#override',
  ]) await assert.rejects(assertPilotDatabase(url), /Local pilot requires/);
});

test('local mailbox refuses real mail credentials before opening the application', async () => {
  const previous = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = 'synthetic-but-not-the-designated-local-key';
  try { await assert.rejects(startLocalPilot(), /real mail credential/); }
  finally { if (previous === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = previous; }
});
