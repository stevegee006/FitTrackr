import { buildApp } from './app.js';
import { env } from './config/env.js';
import { seedExercisesIfEmpty } from './services/seed.service.js';

async function main() {
  const app = await buildApp();

  try {
    await seedExercisesIfEmpty(app.prisma);
    await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
