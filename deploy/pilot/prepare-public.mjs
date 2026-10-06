import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const publicDirectory = fileURLToPath(new URL('../public/', import.meta.url));
const oldApi = 'https://beautyflow-ihl7.vercel.app';
const oldSupabase = "const SUPABASE_URL='https://cykgkqkmdeimfsnybuqg.supabase.co';";

for (const name of ['index.html', 'admin.html', 'booking.html']) {
  const path = `${publicDirectory}${name}`;
  let html = await readFile(path, 'utf8');
  if (!html.includes(oldApi)) throw new Error(`${name}: expected API address is missing`);
  // Empty API base makes requests same-origin: '/api/...'. Source files stay intact.
  html = html.replaceAll(oldApi, '');
  if (name === 'index.html') {
    if (!html.includes(oldSupabase)) throw new Error('index.html: expected legacy Supabase address is missing');
    html = html.replace(oldSupabase, "const SUPABASE_URL=location.origin+'/unused-supabase';");
  }
  if (html.includes(oldApi) || html.includes('cykgkqkmdeimfsnybuqg.supabase.co')) {
    throw new Error(`${name}: live service address remains in pilot HTML`);
  }
  await writeFile(path, html);
}
