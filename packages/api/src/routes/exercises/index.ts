import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createExerciseSchema, updateExerciseSchema } from '@fittrackr/shared';
import * as exerciseService from '../../services/exercise.service.js';
import { searchWger } from '../../services/wger.service.js';

export default async function exerciseRoutes(fastify: FastifyInstance) {
  // GET /exercises — search + paginate
  fastify.get('/exercises', {
    preHandler: [fastify.authenticate],
    handler: async (req) => {
      const { search, muscle, equipment, page = '1', limit = '20' } = req.query as any;
      return exerciseService.getExercises(fastify, {
        search,
        muscle,
        equipment,
        page: parseInt(page),
        limit: Math.min(parseInt(limit), 100),
      });
    },
  });

  // GET /exercises/search/wger — proxy Wger search
  fastify.get('/exercises/search/wger', {
    preHandler: [fastify.authenticate],
    handler: async (req) => {
      const { q } = req.query as any;
      if (!q || q.length < 2) return { data: [] };
      const results = await searchWger(fastify, q);
      return { data: results };
    },
  });

  // GET /exercises/:id
  fastify.get('/exercises/:id', {
    preHandler: [fastify.authenticate],
    handler: async (req) => {
      const { id } = req.params as any;
      const exercise = await exerciseService.getExerciseById(fastify, id);
      return { data: exercise };
    },
  });

  // POST /exercises
  fastify.post('/exercises', {
    preHandler: [fastify.authenticate],
    handler: async (req, reply) => {
      const body = createExerciseSchema.parse(req.body);
      const exercise = await exerciseService.createExercise(fastify, req.user.id, body, req.user.isAdmin);
      return reply.code(201).send({ data: exercise });
    },
  });

  // PATCH /exercises/:id
  fastify.patch('/exercises/:id', {
    preHandler: [fastify.authenticate],
    handler: async (req) => {
      const { id } = req.params as any;
      const body = updateExerciseSchema.parse(req.body);
      const exercise = await exerciseService.updateExercise(fastify, req.user.id, id, body, req.user.isAdmin);
      return { data: exercise };
    },
  });

  // DELETE /exercises/:id
  fastify.delete('/exercises/:id', {
    preHandler: [fastify.authenticate],
    handler: async (req, reply) => {
      const { id } = req.params as any;
      await exerciseService.deleteExercise(fastify, req.user.id, id, req.user.isAdmin);
      return reply.code(204).send();
    },
  });
}
