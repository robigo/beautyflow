import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { migrateAllTenants, pool } from './database.js';

const migrationPath = fileURLToPath(new URL('../sql/001_platform.sql', import.meta.url));
const sql = await readFile(migrationPath, 'utf8');
await pool.query(sql);
await migrateAllTenants();
await pool.end();
console.log('Platform and tenant migrations completed.');
