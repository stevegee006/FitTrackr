import type { FastifyInstance } from 'fastify';
import {
  createWorkoutSchema, updateWorkoutSchema, addSetSchema, updateSetSchema, finishWorkoutSchema,
  // Interpolated into the prompt below rather than written out: a muscle group
  // the model is never told about is one it can never return.
  muscleGroupValues, equipmentValues, exerciseCategoryValues,
} from '@fittrackr/shared';
import * as workoutService from '../../services/workout.service.js';
import { aiChatCompletion, aiVisionCompletion } from '../../services/ai-provider.service.js';

const WORKOUT_AI_SYSTEM = `You are an expert personal trainer. Generate or parse a single workout session.

Return ONLY valid JSON with this exact structure:
{
  "name": "descriptive workout name",
  "workoutType": "PUSH",
  "exercises": [
    {
      "name": "Barbell Bench Press",
      "primaryMuscle": "CHEST",
      "equipment": "BARBELL",
      "category": "COMPOUND",
      "sets": 4,
      "reps": "6-8",
      "rpe": 8,
      "notes": "Focus on chest stretch at bottom"
    }
  ]
}

workoutType must be one of: PUSH, PULL, LEGS, UPPER, LOWER, FULL_BODY, CARDIO, CUSTOM
primaryMuscle must be one of: ${muscleGroupValues.join(', ')}
equipment must be one of: ${equipmentValues.join(', ')}
category must be one of: ${exerciseCategoryValues.join(', ')}
Every exercise MUST include primaryMuscle, equipment, and category. rpe and notes are optional.`;

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

  // GET /workouts/:id/summary — end-of-session recap vs the previous session
  fastify.get('/workouts/:id/summary', {
    preHandler: [fastify.authenticate],
    handler: async (req) => {
      const { id } = req.params as any;
      const data = await workoutService.getWorkoutSummary(fastify, req.user.sub, id);
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

  // PATCH /workouts/:id/exercise-order
  fastify.patch('/workouts/:id/exercise-order', {
    preHandler: [fastify.authenticate],
    handler: async (req) => {
      const { id } = req.params as any;
      const { exerciseOrder } = req.body as { exerciseOrder: string[] };
      await workoutService.reorderExercises(fastify, req.user.sub, id, exerciseOrder);
      return { ok: true };
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

  // POST /workouts/:id/finish — finalize the session
  fastify.post('/workouts/:id/finish', {
    preHandler: [fastify.authenticate],
    handler: async (req) => {
      const { id } = req.params as any;
      const body = finishWorkoutSchema.parse(req.body ?? {});
      const data = await workoutService.finishWorkout(fastify, req.user.sub, id, body);
      return { data };
    },
  });

  // POST /workouts/:id/reopen — undo finish so the session can be logged into again
  fastify.post('/workouts/:id/reopen', {
    preHandler: [fastify.authenticate],
    handler: async (req) => {
      const { id } = req.params as any;
      const data = await workoutService.reopenWorkout(fastify, req.user.sub, id);
      return { data };
    },
  });

  // DELETE /workouts/:id/exercises/:exerciseId — remove an exercise and all its sets
  fastify.delete('/workouts/:id/exercises/:exerciseId', {
    preHandler: [fastify.authenticate],
    handler: async (req, reply) => {
      const { id, exerciseId } = req.params as any;
      const data = await workoutService.deleteWorkoutExercise(fastify, req.user.sub, id, exerciseId);
      return reply.send({ data });
    },
  });

  // POST /workouts/ai-generate — generate a workout with AI
  fastify.post('/workouts/ai-generate', {
    preHandler: [fastify.authenticate],
    handler: async (req, reply) => {
      const { workoutType, preferences } = req.body as { workoutType?: string; preferences?: string };
      const typeHint = workoutType ? `Workout type: ${workoutType}.` : '';
      const prefHint = preferences ? `User preferences / notes: ${preferences}.` : '';
      const userPrompt = `Generate a well-structured single workout session for a fully-equipped gym.
${typeHint} ${prefHint}
Include 4–7 exercises with appropriate sets, reps, RPE, and coaching notes.
Choose a specific workoutType that best fits the session.`;

      try {
        const result = await aiChatCompletion(fastify, req.user.sub, WORKOUT_AI_SYSTEM, userPrompt, {
          tier: 'heavy',
          maxTokens: 2000,
          temperature: 0.5,
        });
        const parsed = JSON.parse(result.content);
        return reply.send({ data: parsed });
      } catch (err: any) {
        return reply.code(503).send({ error: { code: 'AI_UNAVAILABLE', message: err?.message || 'AI generation failed.' } });
      }
    },
  });

  // POST /workouts/ai-import — parse a workout from one or more screenshot images
  fastify.post('/workouts/ai-import', {
    preHandler: [fastify.authenticate],
    handler: async (req, reply) => {
      const body = req.body as { images?: string[]; imageBase64?: string };
      const allImages = body.images?.length ? body.images : body.imageBase64 ? [body.imageBase64] : [];
      if (!allImages.length) return reply.code(400).send({ error: { code: 'BAD_REQUEST', message: 'images array is required.' } });

      const userPrompt = `Extract every exercise from this workout image. If the image shows a whiteboard, app screenshot, book page, or handwritten notes, capture all exercises visible. If sets/reps/weight aren't shown for an exercise, use sensible defaults. Determine the most appropriate workoutType for the overall session.`;

      try {
        const results = await Promise.all(
          allImages.map((img) =>
            aiVisionCompletion(fastify, req.user.sub, WORKOUT_AI_SYSTEM, userPrompt, img, {
              tier: 'vision',
              maxTokens: 2000,
              temperature: 0.2,
            })
          )
        );

        // Merge exercises from all images, deduplicate by name
        let workoutName: string | undefined;
        let workoutType: string | undefined;
        const mergedExercises: any[] = [];
        const seen = new Set<string>();

        for (const result of results) {
          const parsed = JSON.parse(result.content);
          if (!workoutName) workoutName = parsed.name;
          if (!workoutType) workoutType = parsed.workoutType;
          for (const ex of parsed.exercises ?? []) {
            const key = String(ex.name ?? '').toLowerCase().trim();
            if (key && !seen.has(key)) {
              seen.add(key);
              mergedExercises.push(ex);
            }
          }
        }

        return reply.send({ data: { name: workoutName, workoutType, exercises: mergedExercises } });
      } catch (err: any) {
        return reply.code(503).send({ error: { code: 'AI_UNAVAILABLE', message: err?.message || 'AI import failed.' } });
      }
    },
  });

  // POST /workouts/:id/superset — group two or more exercises into a superset/circuit
  fastify.post('/workouts/:id/superset', {
    preHandler: [fastify.authenticate],
    handler: async (req, reply) => {
      const { id } = req.params as any;
      const { exerciseIds } = req.body as { exerciseIds: string[] };
      if (!exerciseIds || exerciseIds.length < 2) {
        return reply.code(400).send({ error: { code: 'BAD_REQUEST', message: 'Provide at least 2 exerciseIds.' } });
      }

      // Both superset routes write with `updateMany({ where: { workoutId } })`
      // and neither used to check who owns the workout — being authenticated
      // was enough to regroup any user's sets. Every other write in this file
      // goes through a service that verifies ownership first.
      await workoutService.assertWorkoutOwner(fastify, req.user.sub, id);

      // Reuse an existing group if any exercise is already in one
      const existing = await fastify.prisma.workoutSet.findFirst({
        where: { workoutId: id, exerciseId: { in: exerciseIds }, supersetGroupId: { not: null } },
        select: { supersetGroupId: true },
      });
      const groupId = existing?.supersetGroupId ?? crypto.randomUUID();

      await fastify.prisma.workoutSet.updateMany({
        where: { workoutId: id, exerciseId: { in: exerciseIds } },
        data: { supersetGroupId: groupId },
      });
      return reply.send({ data: { groupId } });
    },
  });

  // DELETE /workouts/:id/superset/:groupId — dissolve a superset group
  fastify.delete('/workouts/:id/superset/:groupId', {
    preHandler: [fastify.authenticate],
    handler: async (req, reply) => {
      const { id, groupId } = req.params as any;
      await workoutService.assertWorkoutOwner(fastify, req.user.sub, id);
      await fastify.prisma.workoutSet.updateMany({
        where: { workoutId: id, supersetGroupId: groupId },
        data: { supersetGroupId: null },
      });
      return reply.code(204).send();
    },
  });
}
