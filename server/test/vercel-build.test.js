import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

for (const target of ['preview', 'production', undefined]) {
  test(`build never needs a database or mail secrets (${target ?? 'local'})`, () => {
    // An intentionally minimal environment: no database, JWT, or mail credentials.
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../src/vercel-build.js', import.meta.url))], {
      env: target ? { VERCEL_ENV: target } : {}, encoding: 'utf8', timeout: 10000
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /migrations skipped/);
  });
}
