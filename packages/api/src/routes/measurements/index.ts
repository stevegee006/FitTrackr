import type { FastifyInstance } from 'fastify';
import { createBodyMeasurementSchema, measurementQuerySchema, measurementRangeSchema } from '@fittrackr/shared';
import * as measurementService from '../../services/measurement.service.js';

export default async function measurementRoutes(fastify: FastifyInstance) {
  fastify.addHook('onRequest', fastify.authenticate);

  fastify.post('/measurements', async (request, reply) => {
    const body = createBodyMeasurementSchema.parse(request.body);
    const entry = await measurementService.createMeasurement(fastify, request.user.sub, body);
    reply.code(201).send({ data: entry });
  });

  fastify.get('/measurements', async (request) => {
    const { page, limit } = measurementQuerySchema.parse(request.query);
    const result = await measurementService.getMeasurements(fastify, request.user.sub, page, limit);
    return result;
  });

  fastify.get('/measurements/range', async (request) => {
    const { from, to } = measurementRangeSchema.parse(request.query);
    const data = await measurementService.getMeasurementRange(fastify, request.user.sub, from, to);
    return { data };
  });

  fastify.delete('/measurements/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    await measurementService.deleteMeasurement(fastify, request.user.sub, id);
    reply.code(204).send();
  });
}
