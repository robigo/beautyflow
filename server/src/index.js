import 'dotenv/config';
import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { z } from 'zod';
import { pool, provisionTenant, schemaNameFor, withTenant } from './database.js';
import { hashPassword, requireAuth, signToken, verifyPassword } from './auth.js';

if (!process.env.DATABASE_URL || !process.env.JWT_SECRET) throw new Error('DATABASE_URL and JWT_SECRET are required');

const app = express();
app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_ORIGIN?.split(',') ?? true }));
app.use(express.json({ limit: '100kb' }));

const credentials = z.object({ email: z.string().email().transform(value => value.toLowerCase()), password: z.string().min(8).max(128) });
const businessInput = z.object({ name: z.string().trim().min(2).max(100), businessType: z.string().trim().min(2).max(100) });
const appointmentInput = z.object({ customerName: z.string().trim().min(2).max(100), phone: z.string().trim().max(40).optional(), serviceId: z.string().uuid().optional(), serviceName: z.string().trim().min(1).max(100).optional(), resourceId: z.string().uuid().optional(), price: z.coerce.number().min(0).optional(), startsAt: z.string().datetime(), notes: z.string().max(2000).optional(), status: z.enum(['ממתין', 'מאושר', 'הושלם', 'בוטל', 'לא הגיע']).optional() });
const leadInput = z.object({ fullName: z.string().trim().min(2).max(100), phone: z.string().trim().min(4).max(40), serviceName: z.string().trim().max(100).optional(), message: z.string().trim().max(2000).optional() });
const resourceInput = z.object({ name: z.string().trim().min(2).max(100), resourceType: z.string().trim().min(2).max(60).default('איש צוות'), capacity: z.coerce.number().int().min(1).max(20).default(1) });
const serviceInput = z.object({ name: z.string().trim().min(2).max(100), price: z.coerce.number().min(0), durationMinutes: z.coerce.number().int().min(15).max(480), preparationMinutes: z.coerce.number().int().min(0).max(180).default(0), bufferMinutes: z.coerce.number().int().min(0).max(180).default(0), resourceIds: z.array(z.string().uuid()).default([]) });
const timeBlockInput = z.object({ resourceId: z.string().uuid().optional(), startsAt: z.string().datetime(), endsAt: z.string().datetime(), reason: z.string().trim().max(300).optional() }).refine(value => new Date(value.endsAt) > new Date(value.startsAt), { message: 'זמן הסיום חייב להיות אחרי זמן ההתחלה' });
const publicAppointmentInput = z.object({ customerName: z.string().trim().min(2).max(100), phone: z.string().trim().min(4).max(40), serviceId: z.string().uuid(), resourceId: z.string().uuid(), startsAt: z.string().datetime() });

const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const platformAdminEmail = process.env.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase();
const isPlatformAdminEmail = email => Boolean(platformAdminEmail && email.toLowerCase() === platformAdminEmail);
async function ownedBusiness(userId, businessId) {
  const { rows } = await pool.query('select id, name, business_type, schema_name, public_id from public.businesses where id = $1 and owner_id = $2', [businessId, userId]);
  return rows[0];
}

app.get(['/health', '/api/health'], asyncRoute(async (_req, res) => { await pool.query('select 1'); res.json({ ok: true }); }));

app.post('/api/auth/register', asyncRoute(async (req, res) => {
  const { email, password } = credentials.parse(req.body);
  const passwordHash = await hashPassword(password);
  const client = await pool.connect();
  try {
    await client.query('begin');
    const { rows } = await client.query('insert into public.app_users (email, password_hash, is_platform_admin) values ($1, $2, $3) returning id, email, is_platform_admin', [email, passwordHash, isPlatformAdminEmail(email)]);
    await client.query('commit');
    res.status(201).json({ token: signToken(rows[0]), user: rows[0] });
  } catch (error) {
    await client.query('rollback');
    if (error.code === '23505') return res.status(409).json({ error: 'כתובת האימייל כבר רשומה' });
    throw error;
  } finally { client.release(); }
}));

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const { email, password } = credentials.parse(req.body);
  const { rows } = await pool.query('select id, email, password_hash, is_platform_admin from public.app_users where email = $1', [email]);
  const user = rows[0];
  if (!user || !(await verifyPassword(password, user.password_hash))) return res.status(401).json({ error: 'אימייל או סיסמה שגויים' });
  res.json({ token: signToken(user), user: { id: user.id, email: user.email, isPlatformAdmin: user.is_platform_admin } });
}));

app.get('/api/admin/overview', requireAuth, asyncRoute(async (req, res) => {
  const { rows: admins } = await pool.query('select is_platform_admin from public.app_users where id = $1', [req.user.sub]);
  if (!admins[0]?.is_platform_admin) return res.status(403).json({ error: 'נדרשת הרשאת אדמין ראשי' });
  const { rows: businesses } = await pool.query('select id, name, business_type as "businessType", public_id as "publicId", created_at as "createdAt" from public.businesses order by created_at desc');
  const { rows: users } = await pool.query('select count(*)::int as count from public.app_users');
  res.json({ counts: { users: users[0].count, businesses: businesses.length }, businesses });
}));

app.get('/api/businesses', requireAuth, asyncRoute(async (req, res) => {
  const { rows } = await pool.query('select id, name, business_type as "businessType", public_id as "publicId", created_at as "createdAt" from public.businesses where owner_id = $1 order by created_at', [req.user.sub]);
  res.json(rows);
}));

app.post('/api/businesses', requireAuth, asyncRoute(async (req, res) => {
  const input = businessInput.parse(req.body);
  const client = await pool.connect();
  try {
    await client.query('begin');
    const provisionalId = crypto.randomUUID();
    const schemaName = schemaNameFor(provisionalId);
    const { rows } = await client.query('insert into public.businesses (id, owner_id, name, business_type, schema_name) values ($1, $2, $3, $4, $5) returning id, name, business_type as "businessType", public_id as "publicId"', [provisionalId, req.user.sub, input.name, input.businessType, schemaName]);
    await provisionTenant(client, schemaName);
    await client.query('commit');
    res.status(201).json(rows[0]);
  } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
}));

app.get('/api/businesses/:businessId/workspace', requireAuth, asyncRoute(async (req, res) => {
  const business = await ownedBusiness(req.user.sub, req.params.businessId);
  if (!business) return res.status(404).json({ error: 'העסק לא נמצא' });
  const data = await withTenant(business.schema_name, async client => {
    const [settings, services, resources, businessHours, timeBlocks, customers, appointments, leads, waitlist, packages] = await Promise.all([
      client.query('select brand_color as "brandColor", slot_length as "slotLength", treatments from business_settings where id = true'),
      client.query('select id, name, price, duration_minutes as "durationMinutes", preparation_minutes as "preparationMinutes", buffer_minutes as "bufferMinutes", is_active as "isActive" from services order by name'),
      client.query('select id, name, resource_type as "resourceType", capacity, is_active as "isActive" from resources order by name'),
      client.query('select day_of_week as "dayOfWeek", opens_at as "opensAt", closes_at as "closesAt", is_closed as "isClosed" from business_hours order by day_of_week'),
      client.query('select id, resource_id as "resourceId", starts_at as "startsAt", ends_at as "endsAt", reason from time_blocks order by starts_at'),
      client.query('select * from customers order by full_name'),
      client.query('select * from appointments order by starts_at desc'), client.query('select * from leads order by created_at desc'),
      client.query('select * from waitlist_entries order by created_at desc'), client.query('select * from packages order by created_at desc')
    ]);
    return { settings: settings.rows[0], services: services.rows, resources: resources.rows, businessHours: businessHours.rows, timeBlocks: timeBlocks.rows, customers: customers.rows, appointments: appointments.rows, leads: leads.rows, waitlist: waitlist.rows, packages: packages.rows };
  });
  res.json({ business: { id: business.id, name: business.name, businessType: business.business_type, publicId: business.public_id }, ...data });
}));

app.post('/api/businesses/:businessId/appointments', requireAuth, asyncRoute(async (req, res) => {
  const business = await ownedBusiness(req.user.sub, req.params.businessId);
  if (!business) return res.status(404).json({ error: 'העסק לא נמצא' });
  const item = appointmentInput.parse(req.body);
  const row = await withTenant(business.schema_name, async client => {
    const service = item.serviceId ? (await client.query('select id, name, price, duration_minutes, buffer_minutes from services where id = $1 and is_active = true', [item.serviceId])).rows[0] : null;
    if (item.serviceId && !service) return null;
    const durationMinutes = service?.duration_minutes ?? 60;
    const endsAt = new Date(new Date(item.startsAt).getTime() + (durationMinutes + (service?.buffer_minutes ?? 0)) * 60000).toISOString();
    if (item.resourceId) {
      const resource = (await client.query('select id from resources where id = $1 and is_active = true', [item.resourceId])).rows[0];
      if (!resource) throw Object.assign(new Error('המשאב אינו זמין'), { statusCode: 400 });
      if (service) {
        const mapping = await client.query('select 1 from service_resources where service_id = $1 limit 1', [service.id]);
        if (mapping.rows[0] && !(await client.query('select 1 from service_resources where service_id = $1 and resource_id = $2', [service.id, item.resourceId])).rows[0]) {
          throw Object.assign(new Error('המשאב אינו מבצע שירות זה'), { statusCode: 400 });
        }
      }
      const block = (await client.query('select 1 from time_blocks where (resource_id = $1 or resource_id is null) and starts_at < $3 and ends_at > $2 limit 1', [item.resourceId, item.startsAt, endsAt])).rows[0];
      if (block) throw Object.assign(new Error('הזמן שנבחר חסום'), { statusCode: 409 });
    }
    const customer = item.phone ? await client.query('insert into customers (full_name, phone) values ($1, $2) on conflict (phone) do update set full_name = excluded.full_name returning id', [item.customerName, item.phone]) : { rows: [] };
    const result = await client.query('insert into appointments (customer_id, customer_name, phone, service_id, service_name, resource_id, price, starts_at, ends_at, notes, status) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *', [customer.rows[0]?.id ?? null, item.customerName, item.phone ?? null, service?.id ?? null, service?.name ?? item.serviceName, item.resourceId ?? null, service?.price ?? item.price ?? 0, item.startsAt, endsAt, item.notes ?? null, item.status ?? 'ממתין']);
    return result.rows[0];
  });
  if (!row) return res.status(400).json({ error: 'השירות אינו זמין' });
  res.status(201).json(row);
}));

app.patch('/api/businesses/:businessId/appointments/:appointmentId', requireAuth, asyncRoute(async (req, res) => {
  const business = await ownedBusiness(req.user.sub, req.params.businessId);
  if (!business) return res.status(404).json({ error: 'העסק לא נמצא' });
  const status = z.enum(['ממתין', 'מאושר', 'הושלם', 'בוטל', 'לא הגיע']).parse(req.body.status);
  const row = await withTenant(business.schema_name, async client => (await client.query('update appointments set status = $1 where id = $2 returning id, status', [status, req.params.appointmentId])).rows[0]);
  if (!row) return res.status(404).json({ error: 'התור לא נמצא' });
  res.json(row);
}));

app.get('/api/businesses/:businessId/resources', requireAuth, asyncRoute(async (req, res) => {
  const business = await ownedBusiness(req.user.sub, req.params.businessId);
  if (!business) return res.status(404).json({ error: 'העסק לא נמצא' });
  const rows = await withTenant(business.schema_name, client => client.query('select id, name, resource_type as "resourceType", capacity, is_active as "isActive" from resources order by name'));
  res.json(rows.rows);
}));

app.post('/api/businesses/:businessId/resources', requireAuth, asyncRoute(async (req, res) => {
  const business = await ownedBusiness(req.user.sub, req.params.businessId);
  if (!business) return res.status(404).json({ error: 'העסק לא נמצא' });
  const item = resourceInput.parse(req.body);
  const row = await withTenant(business.schema_name, async client => (await client.query('insert into resources (name, resource_type, capacity) values ($1,$2,$3) returning id, name, resource_type as "resourceType", capacity, is_active as "isActive"', [item.name, item.resourceType, item.capacity])).rows[0]);
  res.status(201).json(row);
}));

app.post('/api/businesses/:businessId/services', requireAuth, asyncRoute(async (req, res) => {
  const business = await ownedBusiness(req.user.sub, req.params.businessId);
  if (!business) return res.status(404).json({ error: 'העסק לא נמצא' });
  const item = serviceInput.parse(req.body);
  const row = await withTenant(business.schema_name, async client => {
    const created = (await client.query('insert into services (name, price, duration_minutes, preparation_minutes, buffer_minutes) values ($1,$2,$3,$4,$5) returning id, name, price, duration_minutes as "durationMinutes", preparation_minutes as "preparationMinutes", buffer_minutes as "bufferMinutes"', [item.name, item.price, item.durationMinutes, item.preparationMinutes, item.bufferMinutes])).rows[0];
    for (const resourceId of item.resourceIds) await client.query('insert into service_resources (service_id, resource_id) values ($1,$2)', [created.id, resourceId]);
    return created;
  });
  res.status(201).json(row);
}));

app.post('/api/businesses/:businessId/time-blocks', requireAuth, asyncRoute(async (req, res) => {
  const business = await ownedBusiness(req.user.sub, req.params.businessId);
  if (!business) return res.status(404).json({ error: 'העסק לא נמצא' });
  const item = timeBlockInput.parse(req.body);
  const row = await withTenant(business.schema_name, async client => (await client.query('insert into time_blocks (resource_id, starts_at, ends_at, reason) values ($1,$2,$3,$4) returning id, resource_id as "resourceId", starts_at as "startsAt", ends_at as "endsAt", reason', [item.resourceId ?? null, item.startsAt, item.endsAt, item.reason ?? null])).rows[0]);
  res.status(201).json(row);
}));

app.get('/api/public/businesses/:publicId', asyncRoute(async (req, res) => {
  const { rows } = await pool.query('select id, name, business_type, schema_name from public.businesses where public_id = $1', [req.params.publicId]);
  const business = rows[0];
  if (!business) return res.status(404).json({ error: 'העסק לא נמצא' });
  const { services, resources } = await withTenant(business.schema_name, async client => ({
    services: await client.query('select id, name, price, duration_minutes as "durationMinutes" from services where is_active = true order by name'),
    resources: await client.query('select id, name, resource_type as "resourceType" from resources where is_active = true order by name')
  }));
  res.json({ name: business.name, businessType: business.business_type, services: services.rows, resources: resources.rows });
}));

app.get('/api/public/businesses/:publicId/availability', asyncRoute(async (req, res) => {
  const query = z.object({ serviceId: z.string().uuid(), resourceId: z.string().uuid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(req.query);
  const { rows } = await pool.query('select schema_name from public.businesses where public_id = $1', [req.params.publicId]);
  if (!rows[0]) return res.status(404).json({ error: 'העסק לא נמצא' });
  const result = await withTenant(rows[0].schema_name, async client => {
    const [serviceResult, resourceResult, hoursResult, settingsResult] = await Promise.all([
      client.query('select id, duration_minutes, preparation_minutes, buffer_minutes from services where id = $1 and is_active = true', [query.serviceId]),
      client.query('select id from resources where id = $1 and is_active = true', [query.resourceId]),
      client.query('select opens_at, closes_at, is_closed from business_hours where day_of_week = $1', [new Date(`${query.date}T12:00:00Z`).getUTCDay()]),
      client.query('select slot_length from business_settings where id = true')
    ]);
    const service = serviceResult.rows[0], resource = resourceResult.rows[0], hours = hoursResult.rows[0];
    if (!service || !resource || !hours || hours.is_closed) return { slots: [] };
    const mapping = await client.query('select 1 from service_resources where service_id = $1 limit 1', [service.id]);
    if (mapping.rows[0] && !(await client.query('select 1 from service_resources where service_id = $1 and resource_id = $2', [service.id, resource.id])).rows[0]) return { slots: [] };
    const offset = '+03:00'; // Israel local time; the booking UI and production users are in Israel.
    const open = new Date(`${query.date}T${hours.opens_at}${offset}`), close = new Date(`${query.date}T${hours.closes_at}${offset}`);
    const [{ rows: appointments }, { rows: blocks }] = await Promise.all([
      client.query("select starts_at, ends_at from appointments where resource_id = $1 and status <> 'בוטל' and starts_at < $3 and ends_at > $2", [resource.id, open.toISOString(), close.toISOString()]),
      client.query('select starts_at, ends_at from time_blocks where (resource_id = $1 or resource_id is null) and starts_at < $3 and ends_at > $2', [resource.id, open.toISOString(), close.toISOString()])
    ]);
    const busy = [...appointments, ...blocks];
    const duration = (service.duration_minutes + service.preparation_minutes + service.buffer_minutes) * 60000;
    const step = settingsResult.rows[0]?.slot_length ?? 30, slots = [];
    for (let cursor = open.getTime(); cursor + duration <= close.getTime(); cursor += step * 60000) {
      const end = cursor + duration;
      if (!busy.some(item => new Date(item.starts_at).getTime() < end && new Date(item.ends_at).getTime() > cursor)) slots.push(new Date(cursor).toISOString());
    }
    return { slots };
  });
  res.json(result);
}));

app.post('/api/public/businesses/:publicId/appointments', asyncRoute(async (req, res) => {
  const item = publicAppointmentInput.parse(req.body);
  const { rows } = await pool.query('select schema_name from public.businesses where public_id = $1', [req.params.publicId]);
  if (!rows[0]) return res.status(404).json({ error: 'העסק לא נמצא' });
  const appointment = await withTenant(rows[0].schema_name, async client => {
    const service = (await client.query('select id, name, price, duration_minutes, buffer_minutes from services where id = $1 and is_active = true', [item.serviceId])).rows[0];
    const resource = (await client.query('select id from resources where id = $1 and is_active = true', [item.resourceId])).rows[0];
    if (!service || !resource) throw Object.assign(new Error('השירות או המשאב אינם זמינים'), { statusCode: 400 });
    const mapping = await client.query('select 1 from service_resources where service_id = $1 limit 1', [service.id]);
    if (mapping.rows[0] && !(await client.query('select 1 from service_resources where service_id = $1 and resource_id = $2', [service.id, resource.id])).rows[0]) {
      throw Object.assign(new Error('המשאב אינו מבצע שירות זה'), { statusCode: 400 });
    }
    const endsAt = new Date(new Date(item.startsAt).getTime() + (service.duration_minutes + service.buffer_minutes) * 60000).toISOString();
    const block = (await client.query('select 1 from time_blocks where (resource_id = $1 or resource_id is null) and starts_at < $3 and ends_at > $2 limit 1', [resource.id, item.startsAt, endsAt])).rows[0];
    if (block) throw Object.assign(new Error('הזמן שנבחר כבר אינו זמין'), { statusCode: 409 });
    const customer = (await client.query('insert into customers (full_name, phone) values ($1,$2) on conflict (phone) do update set full_name = excluded.full_name returning id', [item.customerName, item.phone])).rows[0];
    return (await client.query("insert into appointments (customer_id, customer_name, phone, service_id, service_name, resource_id, price, starts_at, ends_at, status) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'ממתין') returning id, starts_at as \"startsAt\", status", [customer.id, item.customerName, item.phone, service.id, service.name, resource.id, service.price, item.startsAt, endsAt])).rows[0];
  });
  res.status(201).json(appointment);
}));

app.post('/api/public/businesses/:publicId/leads', asyncRoute(async (req, res) => {
  const item = leadInput.parse(req.body);
  const { rows } = await pool.query('select schema_name from public.businesses where public_id = $1', [req.params.publicId]);
  if (!rows[0]) return res.status(404).json({ error: 'העסק לא נמצא' });
  const lead = await withTenant(rows[0].schema_name, async client => (await client.query('insert into leads (full_name, phone, service_name, message) values ($1,$2,$3,$4) returning id, created_at as "createdAt"', [item.fullName, item.phone, item.serviceName ?? null, item.message ?? null])).rows[0]);
  res.status(201).json(lead);
}));

app.use((error, _req, res, _next) => {
  console.error(error);
  if (error instanceof z.ZodError) return res.status(400).json({ error: 'פרטים לא תקינים', details: error.flatten() });
  if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
  if (error.code === '23P01') return res.status(409).json({ error: 'הזמן שנבחר כבר נתפס' });
  res.status(500).json({ error: 'אירעה שגיאה בשרת' });
});

if (!process.env.VERCEL) {
  app.listen(process.env.PORT ?? 3000, () => console.log(`BeautyFlow API listening on port ${process.env.PORT ?? 3000}`));
}

export default app;
