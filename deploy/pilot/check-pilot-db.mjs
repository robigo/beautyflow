const url = new URL(process.env.DATABASE_URL ?? '');
if (url.protocol !== 'postgresql:' || url.hostname !== 'db' || url.pathname !== '/beautyflow_pilot' || url.username !== 'beautyflow') {
  throw new Error('Pilot database must be beautyflow_pilot on the local Compose db service');
}
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  throw new Error('Set a random PILOT_JWT_SECRET of at least 32 characters');
}
