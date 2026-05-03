import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createSsoProviderSchema, updateSsoProviderSchema, adminCreateUserSchema, appSettingsSchema, adminListQuerySchema } from '@fittrackr/shared';
import * as adminService from '../../services/admin.service.js';
import * as ssoService from '../../services/sso.service.js';
import * as appConfigService from '../../services/app-config.service.js';
import * as exerciseIngestService from '../../services/exercise-ingest.service.js';
import { ForbiddenError } from '../../utils/errors.js';

const ingestParseSchema = z.object({
  type: z.enum(['pdf', 'images', 'csv']),
  data: z.union([z.string(), z.array(z.string())]),
});

const ingestImportSchema = z.object({
  items: z.array(z.any()),
});

export default async function adminRoutes(fastify: FastifyInstance) {
  fastify.addHook('onRequest', fastify.authenticate);
  fastify.addHook('onRequest', async (request) => {
    if (!request.user.isAdmin) {
      throw new ForbiddenError('Admin access required');
    }
  });

  // App settings
  fastify.get('/admin/settings', async () => {
    const settings = await appConfigService.getAppSettings(fastify);
    return { data: settings };
  });

  fastify.put('/admin/settings', async (request) => {
    const body = appSettingsSchema.parse(request.body);
    const settings = await appConfigService.updateAppSettings(fastify, body);
    return { data: settings };
  });

  // Stats
  fastify.get('/admin/stats', async () => {
    const stats = await adminService.getStats(fastify);
    return { data: stats };
  });

  // Users
  fastify.post('/admin/users', async (request, reply) => {
    const body = adminCreateUserSchema.parse(request.body);
    const user = await adminService.createUser(fastify, body.email, body.password, body.displayName);
    reply.code(201).send({ data: user });
  });

  fastify.get('/admin/users', async (request) => {
    const { page, limit, q } = adminListQuerySchema.parse(request.query);
    return adminService.listUsers(fastify, page, limit, q);
  });

  fastify.delete('/admin/users/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    await adminService.deleteUser(fastify, request.user.sub, id);
    reply.code(204).send();
  });

  fastify.post('/admin/users/:id/reset-password', async (request) => {
    const { id } = request.params as { id: string };
    const result = await adminService.resetUserPassword(fastify, request.user.sub, id);
    return { data: result };
  });

  // Exercise library management
  fastify.get('/admin/exercises', async (request) => {
    const { page, limit, q } = adminListQuerySchema.parse(request.query);
    return adminService.listExercises(fastify, page, limit, q);
  });

  fastify.patch('/admin/exercises/:id', async (request) => {
    const { id } = request.params as { id: string };
    const data = await adminService.updateExercise(fastify, id, request.body as any);
    return { data };
  });

  fastify.delete('/admin/exercises/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    await adminService.deleteExercise(fastify, id);
    reply.code(204).send();
  });

  // AI Ingest — parse uploaded file into exercises
  fastify.post('/admin/exercises/ingest/parse', {
    bodyLimit: 25 * 1024 * 1024,
    handler: async (request) => {
      const body = ingestParseSchema.parse(request.body);
      let items;
      if (body.type === 'pdf') {
        items = await exerciseIngestService.parsePdfIngest(fastify, request.user.sub, body.data as string);
      } else {
        items = await exerciseIngestService.parseImagesIngest(fastify, request.user.sub, body.data as string[]);
      }
      return { data: items };
    },
  });

  fastify.post('/admin/exercises/ingest/import', async (request, reply) => {
    const body = ingestImportSchema.parse(request.body);
    const result = await exerciseIngestService.bulkImportExercises(fastify, body.items);
    reply.code(201).send({ data: result });
  });

  // SSO
  fastify.get('/admin/sso', async () => {
    const providers = await ssoService.listSsoProviders(fastify);
    return { data: providers };
  });

  fastify.post('/admin/sso', async (request, reply) => {
    const body = createSsoProviderSchema.parse(request.body);
    const provider = await ssoService.createSsoProvider(fastify, body);
    reply.code(201).send({ data: provider });
  });

  fastify.get('/admin/sso/:id', async (request) => {
    const { id } = request.params as { id: string };
    const provider = await ssoService.getSsoProvider(fastify, id);
    return { data: provider };
  });

  fastify.patch('/admin/sso/:id', async (request) => {
    const { id } = request.params as { id: string };
    const body = updateSsoProviderSchema.parse(request.body);
    const provider = await ssoService.updateSsoProvider(fastify, id, body);
    return { data: provider };
  });

  fastify.delete('/admin/sso/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    await ssoService.deleteSsoProvider(fastify, id);
    reply.code(204).send();
  });
}
