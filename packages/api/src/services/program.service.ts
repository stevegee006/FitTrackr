import type { FastifyInstance } from 'fastify';
import type { GenerateProgramInput } from '@fittrackr/shared';
import { aiChatCompletion } from './ai-provider.service.js';
import { NotFoundError, ForbiddenError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

const SYSTEM_PROMPT = `You are an expert personal trainer and strength & conditioning coach. Generate structured, progressive training programs based on the user's goals and experience level.

Return ONLY valid JSON with this structure:
{
  "name": "program name",
  "weeks": [
    {
      "weekNumber": 1,
      "days": [
        {
          "dayOfWeek": 1,
          "workoutType": "PUSH",
          "focus": "Chest & Triceps",
          "exercises": [
            {
              "name": "Barbell Bench Press",
              "sets": 4,
              "reps": "6-8",
              "rpe": 8,
              "notes": "Focus on chest stretch at bottom",
              "primaryMuscle": "CHEST",
              "equipment": "BARBELL",
              "category": "COMPOUND"
            }
          ]
        }
      ]
    }
  ],
  "notes": "optional overall program notes"
}

dayOfWeek: 1=Monday, 2=Tuesday, ..., 7=Sunday
workoutType must be one of: PUSH, PULL, LEGS, UPPER, LOWER, FULL_BODY, CARDIO, CUSTOM
primaryMuscle must be one of: CHEST, BACK, SHOULDERS, BICEPS, TRICEPS, FOREARMS, QUADS, HAMSTRINGS, GLUTES, CALVES, CORE, FULL_BODY
equipment must be one of: BARBELL, DUMBBELL, CABLE, MACHINE, BODYWEIGHT, KETTLEBELL, BANDS, OTHER
category must be one of: COMPOUND, ISOLATION, CARDIO, STRETCHING, OTHER
Every exercise MUST include primaryMuscle, equipment, and category.
Use progressive overload across weeks (increase weight or reps each week).
Rest days should be omitted from the days array.`;

export async function generateProgram(
  fastify: FastifyInstance,
  userId: string,
  input: GenerateProgramInput,
) {
  const { durationWeeks, workoutsPerWeek, primaryGoal, experienceLevel, availableEquipment, preferences } = input;

  const profile = await fastify.prisma.userProfile.findUnique({ where: { userId } });

  const userPrompt = `Generate a ${durationWeeks}-week ${primaryGoal.toLowerCase()} program for a ${experienceLevel.toLowerCase()} trainee.
Training ${workoutsPerWeek} days per week.
Available equipment: ${availableEquipment.length > 0 ? availableEquipment.join(', ') : 'Fully equipped gym'}.
${profile?.sex ? `Sex: ${profile.sex}.` : ''}
${preferences ? `Additional preferences: ${preferences}` : ''}

Create the full ${durationWeeks}-week program with progressive overload.`;

  const result = await aiChatCompletion(fastify, userId, SYSTEM_PROMPT, userPrompt, {
    tier: 'heavy',
    maxTokens: 8000,
    temperature: 0.4,
  });

  let programData: any;
  try {
    programData = JSON.parse(result.content);
  } catch {
    logger.error({ content: result.content.slice(0, 300) }, 'Failed to parse AI program response');
    throw new Error('AI returned invalid JSON for program');
  }

  const name = programData.name ?? `${durationWeeks}-Week ${primaryGoal} Program`;
  delete programData.name;

  // Deactivate existing programs
  await fastify.prisma.program.updateMany({
    where: { userId, isActive: true },
    data: { isActive: false },
  });

  return fastify.prisma.program.create({
    data: {
      userId,
      name,
      durationWeeks,
      programData,
      aiModel: result.model,
      isActive: true,
    },
  });
}

export async function getPrograms(fastify: FastifyInstance, userId: string) {
  return fastify.prisma.program.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getActiveProgram(fastify: FastifyInstance, userId: string) {
  return fastify.prisma.program.findFirst({
    where: { userId, isActive: true },
    orderBy: { createdAt: 'desc' },
  });
}

export async function deleteProgram(fastify: FastifyInstance, userId: string, id: string) {
  const program = await fastify.prisma.program.findUnique({ where: { id } });
  if (!program) throw new NotFoundError('Program');
  if (program.userId !== userId) throw new ForbiddenError('Not your program');
  await fastify.prisma.program.delete({ where: { id } });
}
