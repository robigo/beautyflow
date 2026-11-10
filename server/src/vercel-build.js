// Builds must be reproducible without database credentials or side effects.
// Apply reviewed migrations separately, after confirming the target database.
console.log('Vercel build: database migrations skipped. Run db:migrate separately after target verification.');
if (process.env.VERCEL_ENV === 'preview') {
  const { buildPreviewUI } = await import('./preview-ui.js');
  await buildPreviewUI();
  console.log('Built isolated same-origin Preview UI and bundled browser SDKs.');
}
