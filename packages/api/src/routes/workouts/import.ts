import type { FastifyInstance } from 'fastify';
import { importWorkoutsFromCsv } from '../../services/csv-import.service.js';

export default async function workoutImportRoutes(fastify: FastifyInstance) {
  fastify.post('/workouts/import-csv', {
    preHandler: [fastify.authenticate],
    handler: async (req, reply) => {
      const { csv } = req.body as { csv: string };
      if (!csv || typeof csv !== 'string') {
        return reply.code(400).send({ error: { code: 'BAD_REQUEST', message: 'csv field required' } });
      }
      const summary = await importWorkoutsFromCsv(fastify, req.user.sub, csv);
      return reply.code(200).send({ data: summary });
    },
  });
}
