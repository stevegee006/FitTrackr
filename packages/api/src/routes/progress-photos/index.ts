import type { FastifyInstance } from 'fastify';
import { createProgressPhotoSchema, progressPhotoQuerySchema } from '@fittrackr/shared';
import * as photoService from '../../services/progress-photo.service.js';

export default async function progressPhotoRoutes(fastify: FastifyInstance) {
  fastify.addHook('onRequest', fastify.authenticate);

  fastify.post('/progress-photos', {
    bodyLimit: 10 * 1024 * 1024,
    handler: async (request, reply) => {
      const body = createProgressPhotoSchema.parse(request.body);
      const photo = await photoService.uploadPhoto(fastify, request.user.sub, body);
      reply.code(201).send({ data: photo });
    },
  });

  fastify.get('/progress-photos', async (request) => {
    const { page, limit } = progressPhotoQuerySchema.parse(request.query);
    const result = await photoService.listPhotos(fastify, request.user.sub, page, limit);
    return result;
  });

  fastify.get('/progress-photos/:id/image', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { buffer, contentType } = await photoService.getPhotoImage(fastify, request.user.sub, id);
    reply.type(contentType).send(buffer);
  });

  fastify.delete('/progress-photos/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    await photoService.deletePhoto(fastify, request.user.sub, id);
    reply.code(204).send();
  });
}
