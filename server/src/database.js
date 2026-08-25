import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const { Pool } = pg;
export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const templatePath = fileURLToPath(new URL('../sql/tenant-template.sql', import.meta.url));

export const schemaNameFor = (businessId) => `tenant_${businessId.replaceAll('-', '')}`;

export async function provisionTenant(client, schemaName) {
  // The name is generated internally from a UUID, never supplied by a request.
  if (!/^tenant_[a-z0-9_]+$/.test(schemaName)) throw new Error('Invalid tenant schema');
  await client.query(`create schema if not exists ${schemaName}`);
  const template = await readFile(templatePath, 'utf8');
  await client.query(`set local search_path to ${schemaName}, public`);
  await client.query(template);
  await client.query('insert into business_settings (id) values (true) on conflict do nothing');
}

export async function withTenant(schemaName, action) {
  if (!/^tenant_[a-z0-9_]+$/.test(schemaName)) throw new Error('Invalid tenant schema');
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`set local search_path to ${schemaName}, public`);
    const result = await action(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}
