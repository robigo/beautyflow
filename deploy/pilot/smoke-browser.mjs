import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Runs on the CI host after the isolated Compose stack has started.
const require = createRequire(new URL('../../server/test/browser/package.json', import.meta.url));
const { chromium } = require('playwright');
const origin = 'http://127.0.0.1:8080';
const supabaseSdk = fileURLToPath(new URL('../../server/test/browser/node_modules/@supabase/supabase-js/dist/umd/supabase.js', import.meta.url));
const chartJs = fileURLToPath(new URL('../../server/test/browser/node_modules/chart.js/dist/chart.umd.js', import.meta.url));
const browser = await chromium.launch();
const context = await browser.newContext({ timezoneId: 'Asia/Jerusalem', serviceWorkers: 'block' });
const unexpected = [], pageErrors = [];
await context.route('**/*', route => {
  const url = new URL(route.request().url());
  if (url.origin === origin && !url.pathname.startsWith('/unused-supabase')) return route.continue();
  if (url.href.startsWith('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2')) return route.fulfill({ path: supabaseSdk, contentType: 'text/javascript' });
  if (url.href.startsWith('https://cdn.jsdelivr.net/npm/chart.js')) return route.fulfill({ path: chartJs, contentType: 'text/javascript' });
  unexpected.push(url.origin + url.pathname);
  return route.abort('blockedbyclient');
});

try {
  const owner = await context.newPage();
  owner.setDefaultTimeout(20000);
  owner.on('pageerror', error => pageErrors.push(error.message));
  owner.on('dialog', dialog => dialog.accept());
  await owner.goto(origin + '/');
  await owner.locator('#ownerAuthSwitch').click();
  await owner.locator('#ownerEmail').fill(`docker-${randomUUID()}@example.test`);
  await owner.locator('#ownerPassword').fill('only-for-this-disposable-ci-test');
  await owner.locator('#ownerAuthSubmit').click();
  await owner.locator('#workspacePicker').waitFor({ state: 'visible' });
  await owner.locator('#newBusinessName').fill('New Docker pilot business');
  await owner.locator('#createBusiness').click();
  await owner.locator('#dashboard.active').waitFor({ state: 'visible' });
  await owner.locator('[data-screen="settings"]').click();
  await owner.locator('#resourceName').fill('Pilot room');
  await owner.locator('#resourceForm button').click();
  await owner.locator('#resourceList').getByText('Pilot room').waitFor();
  await owner.locator('#serviceName').fill('Fresh priced service');
  await owner.locator('#servicePrice').fill('135');
  await owner.locator('#serviceDuration').fill('30');
  await owner.locator('#serviceResource').selectOption({ label: 'Pilot room · איש צוות' });
  await owner.locator('#serviceForm button').click();
  await owner.locator('#serviceList').getByText('Fresh priced service').waitFor();

  const token = await owner.evaluate(() => localStorage.getItem('beautyflow-api-token-v1'));
  assert.ok(token);
  const businessResponse = await fetch(origin + '/api/businesses', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(businessResponse.status, 200);
  const [business] = await businessResponse.json();
  assert.ok(business?.publicId);
  const publicResponse = await fetch(`${origin}/api/public/businesses/${business.publicId}`);
  assert.equal(publicResponse.status, 200);
  const publicBusiness = await publicResponse.json();
  const service = publicBusiness.services.find(item => item.name === 'Fresh priced service');
  const resource = publicBusiness.resources.find(item => item.name === 'Pilot room');
  assert.equal(Number(service?.price), 135);
  assert.ok(resource);

  let date;
  for (let day = 2; day < 12 && !date; day++) {
    const candidate = new Date(Date.now() + day * 86_400_000).toISOString().slice(0, 10);
    const availability = await fetch(`${origin}/api/public/businesses/${business.publicId}/availability?serviceId=${service.id}&resourceId=${resource.id}&date=${candidate}`);
    assert.equal(availability.status, 200);
    if ((await availability.json()).slots.length) date = candidate;
  }
  assert.ok(date, 'No public slot in the next 12 days');
  const customer = await context.newPage();
  customer.setDefaultTimeout(20000);
  customer.on('pageerror', error => pageErrors.push(error.message));
  await customer.goto(`${origin}/booking.html?business=${business.publicId}`);
  await customer.locator('#bookingForm').waitFor({ state: 'visible' });
  await customer.locator('#service').selectOption(service.id);
  await customer.locator('#resource').selectOption(resource.id);
  await customer.locator('#name').fill('Fresh customer');
  await customer.locator('#phone').fill('0500000010');
  await customer.locator('#date').fill(date);
  await customer.locator('#date').dispatchEvent('change');
  await customer.waitForFunction(() => !document.querySelector('#time').disabled);
  await customer.locator('#submit').click();
  await customer.locator('#notice.success').waitFor({ state: 'visible' });

  await owner.reload();
  await owner.locator('#dashboard.active').waitFor({ state: 'visible' });
  await owner.locator('[data-screen="calendar"]').click();
  const row = owner.locator('#calendarRows tr').filter({ hasText: 'Fresh customer' });
  await row.waitFor({ state: 'visible' });
  assert.match(await row.innerText(), /135/);
  assert.deepEqual(unexpected, [], 'Unexpected request outside the pilot');
  assert.deepEqual(pageErrors, [], 'Browser script errors');
  console.log('Fresh browser signup, business, service, public booking and owner reload passed.');
} finally {
  await browser.close();
}
