// Preview builds must not connect to a database or apply migrations.
if (process.env.VERCEL_ENV === 'preview') {
  console.log('Preview build: database migrations skipped.');
} else if (process.env.VERCEL_ENV === 'production') {
  // Preserve the existing production build behavior.
  await import('./migrate.js');
} else {
  throw new Error('VERCEL_ENV must be preview or production; no migration started.');
}
