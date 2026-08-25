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
const appointmentInput = z.object({ customerName: z.string().trim().min(2).max(100), phone: z.string().trim().max(40).optional(), serviceName: z.string().trim().min(1).max(100), price: z.coerce.number().min(0), startsAt: z.string().datetime(), notes: z.string().max(2000).optional(), status: z.enum(['מאושר', 'הושלם', 'בוטל']).optional() });
const leadInput = z.object({ fullName: z.string().trim().min(2).max(100), phone: z.string().trim().min(4).max(40), serviceName: z.string().trim().max(100).optional(), message: z.string().trim().max(2000).optional() });

const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
async function ownedBusiness(userId, businessId) {
  const { rows } = await pool.query('select id, name, business_type, schema_name, public_id from public.businesses where id = $1 and owner_id = $2', [businessId, userId]);
  return rows[0];
}

app.get('/health', asyncRoute(async (_req, res) => { await pool.query('select 1'); res.json({ ok: true }); }));

app.post('/api/auth/register', asyncRoute(async (req, res) => {
  const { email, password } = credentials.parse(req.body);
  const passwordHash = await hashPassword(password);
  const client = await pool.connect();
  try {
    await client.query('begin');
    const { rows } = await client.query('insert into public.app_users (email, password_hash) values ($1, $2) returning id, email', [email, passwordHash]);
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
  const { rows } = await pool.query('select id, email, password_hash from public.app_users where email = $1', [email]);
  const user = rows[0];
  if (!user || !(await verifyPassword(password, user.password_hash))) return res.status(401).json({ error: 'אימייל או סיסמה שגויים' });
  res.json({ token: signToken(user), user: { id: user.id, email: user.email } });
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
    const [settings, services, customers, appointments, leads, waitlist, packages] = await Promise.all([
      client.query('select brand_color as "brandColor", slot_length as "slotLength", treatments from business_settings where id = true'),
      client.query('select * from services order by name'), client.query('select * from customers order by full_name'),
      client.query('select * from appointments order by starts_at desc'), client.query('select * from leads order by created_at desc'),
      client.query('select * from waitlist_entries order by created_at desc'), client.query('select * from packages order by created_at desc')
    ]);
    return { settings: settings.rows[0], services: services.rows, customers: customers.rows, appointments: appointments.rows, leads: leads.rows, waitlist: waitlist.rows, packages: packages.rows };
  });
  res.json({ business: { id: business.id, name: business.name, businessType: business.business_type, publicId: business.public_id }, ...data });
}));

app.post('/api/businesses/:businessId/appointments', requireAuth, asyncRoute(async (req, res) => {
  const business = await ownedBusiness(req.user.sub, req.params.businessId);
  if (!business) return res.status(404).json({ error: 'העסק לא נמצא' });
  const item = appointmentInput.parse(req.body);
  const row = await withTenant(business.schema_name, async client => {
    const customer = item.phone ? await client.query('insert into customers (full_name, phone) values ($1, $2) on conflict (phone) do update set full_name = excluded.full_name returning id', [item.customerName, item.phone]) : { rows: [] };
    const result = await client.query('insert into appointments (customer_id, customer_name, phone, service_name, price, starts_at, notes, status) values ($1,$2,$3,$4,$5,$6,$7,$8) returning *', [customer.rows[0]?.id ?? null, item.customerName, item.phone ?? null, item.serviceName, item.price, item.startsAt, item.notes ?? null, item.status ?? 'מאושר']);
    return result.rows[0];
  });
  res.status(201).json(row);
}));

app.get('/api/public/businesses/:publicId', asyncRoute(async (req, res) => {
  const { rows } = await pool.query('select id, name, business_type, schema_name from public.businesses where public_id = $1', [req.params.publicId]);
  const business = rows[0];
  if (!business) return res.status(404).json({ error: 'העסק לא נמצא' });
  const services = await withTenant(business.schema_name, client => client.query('select name from services where is_active = true order by name'));
  res.json({ name: business.name, businessType: business.business_type, services: services.rows.map(item => item.name) });
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
  res.status(500).json({ error: 'אירעה שגיאה בשרת' });
});

if (!process.env.VERCEL) {
  app.listen(process.env.PORT ?? 3000, () => console.log(`BeautyFlow API listening on port ${process.env.PORT ?? 3000}`));
}

export default app;
