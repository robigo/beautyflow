import express from 'express';
import { fileURLToPath } from 'node:url';
import './check-pilot-db.mjs';

// Import the API without starting its default listener; serve the copied UI here.
process.env.VERCEL = '1';
const { default: app } = await import('./src/index.js');
const publicDirectory = fileURLToPath(new URL('../public/', import.meta.url));
app.use(express.static(publicDirectory, {
  dotfiles: 'ignore',
  // The legacy pages contain inline scripts and styles; Helmet's API CSP blocks them.
  setHeaders(response, path) {
    if (path.endsWith('.html')) response.removeHeader('Content-Security-Policy');
  }
}));
app.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log('BeautyFlow pilot ready'));
