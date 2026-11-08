import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import express from 'express';
import {chromium} from 'playwright';
import {assertPilotDatabase} from '../local-pilot.mjs';
import {previewUIMiddleware} from '../../src/preview-ui.js';

test('generated hosted Preview UI registers, persists prices and resets through the real same-origin API', {timeout:90000}, async t=>{
  // Run only against disposable CI, with the real app mounted after the exact
  // generated-UI middleware. No hosted database and no real email are used.
  await assertPilotDatabase();
  assert.notEqual(process.env.VERCEL_ENV,'preview');
  process.env.VERCEL='1';
  const {default:apiApp}=await import('../../src/index.js');
  const {pool}=await import('../../src/database.js');
  const app=express(); app.use(previewUIMiddleware({VERCEL_ENV:'preview'})); app.use(apiApp);
  const server=app.listen(0,'127.0.0.1'); await once(server,'listening');
  const origin='http://127.0.0.1:'+server.address().port;
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await pool.end();});
  const previousFetch=globalThis.fetch; let resetToken;
  globalThis.fetch=async(url,options)=>{
    if(String(url)==='https://api.resend.com/emails') {
      const mail=JSON.parse(options.body);
      assert(mail.to.every(email=>email.endsWith('@example.test')));
      const link=mail.text.match(/http:\/\/127\.0\.0\.1:\d+\/reset-password\.html#token=([a-f0-9]{64})/);
      assert(link);resetToken=link[1];return new Response('{}',{status:200});
    }
    assert(String(url).startsWith(origin+'/'),'No external test requests');
    return previousFetch(url,options);
  };
  t.after(()=>{globalThis.fetch=previousFetch;});
  process.env.RESEND_API_KEY='synthetic-hosted-preview-mail-key';
  process.env.PASSWORD_RESET_FROM='Preview <test@example.test>';
  process.env.PASSWORD_RESET_URL=origin+'/reset-password.html';
  const browser=await chromium.launch({executablePath:process.env.BEAUTYFLOW_TEST_BROWSER||undefined});
  t.after(()=>browser.close());
  const context=await browser.newContext({timezoneId:'Asia/Jerusalem',serviceWorkers:'block'});
  const blocked=[], errors=[];
  await context.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.origin!==origin){blocked.push(url.origin+url.pathname);return route.abort();}
    return route.continue();
  });
  const page=await context.newPage();page.setDefaultTimeout(12000);
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  const email=`hosted-${randomUUID()}@example.test`, password='old-hosted-preview-password';
  const call=async(path,body,token)=>{
    const response=await fetch(origin+path,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});
    assert(response.ok,'API request failed '+path);return response.json();
  };
  await page.goto(origin+'/');
  assert(await page.locator('[data-hosted-preview]').isVisible());
  assert(await page.locator('[data-hosted-preview]').evaluate(el=>{
    const box=el.getBoundingClientRect();return el.contains(document.elementFromPoint(box.left+5,box.top+5));
  }), 'Preview banner must remain visible above the login overlay');
  await page.locator('#ownerAuthSwitch').click();
  await page.locator('#ownerEmail').fill(email);await page.locator('#ownerPassword').fill(password);
  const register=page.waitForResponse(r=>r.url()===origin+'/api/auth/register');
  await page.locator('#ownerAuthSubmit').click();assert.equal((await register).status(),201);
  console.log('Preview UI registration passed');
  await page.locator('#workspacePicker').waitFor({state:'visible'});
  await page.locator('#newBusinessName').fill('Hosted Preview test');
  const created=page.waitForResponse(r=>r.request().method()==='POST'&&r.url()===origin+'/api/businesses');
  await page.locator('#createBusiness').click();const business=await (await created).json();
  await page.locator('#authGate').waitFor({state:'hidden'});
  console.log('Preview UI business creation passed');
  const token=await page.evaluate(()=>localStorage.getItem('beautyflow-api-token-v1'));
  const resource=await call(`/api/businesses/${business.id}/resources`,{name:'Preview room',resourceType:'Room'},token);
  await page.reload();
  await page.waitForFunction(()=>!document.documentElement.classList.contains('restoring-session')&&document.querySelector('#authGate').classList.contains('hide'));
  await page.locator('#dashboard.active').waitFor({state:'visible'});
  await page.locator('[data-screen="settings"]').click();
  await page.locator('#serviceName').fill('Hosted price');await page.locator('#servicePrice').fill('120');
  await page.locator('#serviceDuration').fill('30');await page.locator('#serviceResource').selectOption(resource.id);
  const service=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/services'));
  await page.locator('#serviceForm button').click();assert.equal((await service).status(),201);
  console.log('Preview UI service creation passed');
  const date=new Date(Date.now()+3*86400000).toISOString().slice(0,10);
  for(const [name,price,time] of [['Hosted paid','135','10:00'],['Hosted zero','0','11:00']]){
    await page.locator('[data-screen="book"]').click();
    await page.locator('#bookName').fill(name);await page.locator('#bookPhone').fill('0500000010');
    await page.locator('#bookTreatment').selectOption({label:'Hosted price'});await page.locator('#bookResource').selectOption(resource.id);
    await page.locator('#bookPrice').fill(price);await page.locator('#bookDate').fill(date);await page.locator('#bookTime').fill(time);
    const appointment=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/appointments'));
    await page.locator('#appointmentForm button').click();assert.equal((await appointment).status(),201);
    await page.locator('#calendar.active').waitFor({state:'visible'});
  }
  const workspace=await call(`/api/businesses/${business.id}/workspace`,null,token);
  assert.equal(Number(workspace.appointments.find(a=>a.customer_name==='Hosted paid').price),135);
  assert.equal(Number(workspace.appointments.find(a=>a.customer_name==='Hosted zero').price),0);
  await page.goto(origin+'/reset-password.html');await page.locator('#email').fill(email);await page.locator('#forgotForm button').click();
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('אם קיים חשבון'));
  assert(resetToken);
  await page.goto('about:blank');await page.goto(origin+'/reset-password.html#token='+resetToken);
  assert.equal(new URL(page.url()).hash,'');
  await page.locator('#password').fill('new-hosted-preview-password');await page.locator('#confirm').fill('new-hosted-preview-password');
  await page.locator('#resetForm button').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('הסיסמה עודכנה'));
  assert.equal((await fetch(origin+'/api/businesses',{headers:{Authorization:'Bearer '+token}})).status,401);
  const login=await call('/api/auth/login',{email,password:'new-hosted-preview-password'});
  assert.equal((await call('/api/businesses',null,login.token)).length,1);
  assert.deepEqual(blocked,[]);assert.deepEqual(errors,[]);
});
