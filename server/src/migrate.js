import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { pool } from './database.js';

const migrationPath = fileURLToPath(new URL('../sql/001_platform.sql', import.meta.url));
const sql = await readFile(migrationPath, 'utf8');
await pool.query(sql);
await pool.end();
console.log('Platform migration completed.');
