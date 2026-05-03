import type { FastifyInstance } from 'fastify';
import { createWorkoutSchema, updateWorkoutSchema, addSetSchema, updateSetSchema } from '@fittrackr/shared';
import * as workoutService from '../../services/workout.service.js';

export default async function workoutRoutes(fastify: FastifyInstance) {
  // GET /workouts — paginated list with optional date range
  fastify.get('/workouts', {
    preHandler: [fastify.authenticate],
    handler: async (req) => {
      const { from, to, page = '1', limit = '20' } = req.query as any;
      return workoutService.getWorkouts(fastify, req.user.sub, {
        from,
        to,
        page: parseInt(page),
        limit: Math.min(parseInt(limit), 100),
      });
    },
  });

  // GET /workouts/range — lightweight list (for calendar/streak)
  fastify.get('/workouts/range', {
    preHandler: [fastify.authenticate],
    handler: async (req) => {
      const { from, to } = req.query as any;
      const data = await workoutService.getWorkoutRange(fastify, req.user.sub, from, to);
      return { data };
    },
  });

  // GET /workouts/volume — sets per muscle group for date range
  fastify.get('/workouts/volume', {
    preHandler: [fastify.authenticate],
    handler: async (req) => {
      const { from, to } = req.query as any;
      const data = await workoutService.getWeeklyVolume(fastify, req.user.sub, from, to);
      return { data };
    },
  });

  // GET /workouts/:id
  fastify.get('/workouts/:id', {
    preHandler: [fastify.authenticate],
    handler: async (req) => {
      const { id } = req.params as any;
      const data = await workoutService.getWorkoutById(fastify, req.user.sub, id);
      return { data };
    },
  });

  // POST /workouts
  fastify.post('/workouts', {
    preHandler: [fastify.authenticate],
    handler: async (req, reply) => {
      const body = createWorkoutSchema.parse(req.body);
      const data = await workoutService.createWorkout(fastify, req.user.sub, body);
      return reply.code(201).send({ data });
    },
  });

  // PATCH /workouts/:id
  fastify.patch('/workouts/:id', {
    preHandler: [fastify.authenticate],
    handler: async (req) => {
      const { id } = req.params as any;
      const body = updateWorkoutSchema.parse(req.body);
      const data = await workoutService.updateWorkout(fastify, req.user.sub, id, body);
      return { data };
    },
  });

  // DELETE /workouts/:id
  fastify.delete('/workouts/:id', {
    preHandler: [fastify.authenticate],
    handler: async (req, reply) => {
      const { id } = req.params as any;
      await workoutService.deleteWorkout(fastify, req.user.sub, id);
      return reply.code(204).send();
    },
  });

  // POST /workouts/:id/sets
  fastify.post('/workouts/:id/sets', {
    preHandler: [fastify.authenticate],
    handler: async (req, reply) => {
      const { id } = req.params as any;
      const body = addSetSchema.parse(req.body);
      const data = await workoutService.addSet(fastify, req.user.sub, id, body);
      return reply.code(201).send({ data });
    },
  });

  // PATCH /workouts/:id/sets/:setId
  fastify.patch('/workouts/:id/sets/:setId', {
    preHandler: [fastify.authenticate],
    handler: async (req) => {
      const { id, setId } = req.params as any;
      const body = updateSetSchema.parse(req.body);
      const data = await workoutService.updateSet(fastify, req.user.sub, id, setId, body);
      return { data };
    },
  });

  // DELETE /workouts/:id/sets/:setId
  fastify.delete('/workouts/:id/sets/:setId', {
    preHandler: [fastify.authenticate],
    handler: async (req, reply) => {
      const { id, setId } = req.params as any;
      await workoutService.deleteSet(fastify, req.user.sub, id, setId);
      return reply.code(204).send();
    },
  });
}
