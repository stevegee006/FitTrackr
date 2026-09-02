import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { corsOptions } from './config/cors.js';
import prismaPlugin from './plugins/prisma.js';
import redisPlugin from './plugins/redis.js';
import authPlugin from './plugins/auth.js';
import authRoutes from './routes/auth/index.js';
import userRoutes from './routes/users/index.js';
import adminRoutes from './routes/admin/index.js';
import measurementRoutes from './routes/measurements/index.js';
import progressPhotoRoutes from './routes/progress-photos/index.js';
import oauthRoutes from './routes/auth/oauth.js';
import ssoRoutes from './routes/auth/sso.js';
import passkeyRoutes from './routes/auth/passkey.js';
import exerciseRoutes from './routes/exercises/index.js';
import exercisePreferenceRoutes from './routes/exercises/preferences.js';
import workoutRoutes from './routes/workouts/index.js';
import workoutImportRoutes from './routes/workouts/import.js';
import workoutTemplateRoutes from './routes/workout-templates/index.js';
import programRoutes from './routes/programs/index.js';
import trainingGoalRoutes from './routes/training-goals/index.js';
import personalRecordRoutes from './routes/personal-records/index.js';
import coachRoutes from './routes/coach/index.js';
import awardsRoutes from './routes/awards/index.js';
import { AppError } from './utils/errors.js';
import { logger } from './utils/logger.js';

export async function buildApp() {
  const app = Fastify({
    loggerInstance: logger,
    trustProxy: true,
  });

  // Plugins
  await app.register(cors, corsOptions);
  await app.register(cookie);
  await app.register(helmet, { contentSecurityPolicy: false }); // CSP managed by Next.js
  // 100/min was too tight for real use: logging a set fires a PATCH plus a
  // refetch, and a dense session tripped the limit — a 429 then surfaced as a
  // silently failed save. Keying is per-IP (the plugin default); it cannot be
  // per-user, because this hook runs before authPlugin so request.user is not
  // populated yet.
  await app.register(rateLimit, {
    global: true,
    max: 600,
    timeWindow: '1 minute',
  });
  await app.register(prismaPlugin);
  await app.register(redisPlugin);
  await app.register(authPlugin);

  // Error handler
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details },
      });
    }

    if (error instanceof ZodError) {
      return reply.code(422).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: error.flatten().fieldErrors,
        },
      });
    }

    // Tag unexpected errors so the message shown in the browser can be matched
    // to the stack trace in the container log. Without this, a 500 is
    // undiagnosable from the client side.
    const errorId = randomUUID().slice(0, 8);
    request.log.error({ err: error, errorId }, 'Unhandled error');
    return reply.code(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: `An unexpected error occurred (ref ${errorId})`,
      },
    });
  });

  // Health checks
  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/health/ready', async () => {
    await app.prisma.$queryRaw`SELECT 1`;
    await app.redis.ping();
    return { status: 'ready' };
  });

  // API routes (prefixed)
  await app.register(
    async (api) => {
      // Auth
      await api.register(authRoutes);
      await api.register(oauthRoutes);
      await api.register(ssoRoutes);
      await api.register(passkeyRoutes);
      // Users / profile
      await api.register(userRoutes);
      // Training domain
      await api.register(exerciseRoutes);
      await api.register(exercisePreferenceRoutes);
      await api.register(workoutRoutes);
      await api.register(workoutImportRoutes);
      await api.register(workoutTemplateRoutes);
      await api.register(programRoutes);
      await api.register(trainingGoalRoutes);
      await api.register(personalRecordRoutes);
      await api.register(coachRoutes);
      await api.register(awardsRoutes);
      // Body tracking
      await api.register(measurementRoutes);
      await api.register(progressPhotoRoutes);
      // Admin
      await api.register(adminRoutes);
    },
    { prefix: '/api/v1' },
  );

  return app;
}
