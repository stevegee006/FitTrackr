import type { FastifyInstance } from 'fastify';
import type { GenerateTrainingGoalInput } from '@fittrackr/shared';
import { aiChatCompletion } from './ai-provider.service.js';
import { logger } from '../utils/logger.js';

const SYSTEM_PROMPT = `You are an expert strength & conditioning coach. Generate weekly training volume targets per muscle group based on the user's goal, experience, and frequency.

Return ONLY valid JSON:
{
  "weeklySetTargets": {
    "CHEST": 16,
    "BACK": 20,
    "SHOULDERS": 14,
    "BICEPS": 10,
    "TRICEPS": 10,
    "QUADS": 16,
    "HAMSTRINGS": 12,
    "GLUTES": 12,
    "CORE": 10
  },
  "notes": "optional notes on the targets"
}

Use evidence-based volume landmarks. Beginner: ~10 sets/muscle/week. Intermediate: ~12-16. Advanced: 16-20+.
Prioritize muscle groups based on the goal (e.g. hypertrophy = balanced, strength = compound-focused).`;

export async function generateTrainingGoal(
  fastify: FastifyInstance,
  userId: string,
  input: GenerateTrainingGoalInput,
) {
  const { primaryGoal, weeklyFrequency, experienceLevel } = input;
  const profile = await fastify.prisma.userProfile.findUnique({ where: { userId } });

  const userPrompt = `Goal: ${primaryGoal}
Training frequency: ${weeklyFrequency} days per week
Experience level: ${experienceLevel}
${profile?.sex ? `Sex: ${profile.sex}` : ''}
${profile?.weightKg ? `Body weight: ${profile.weightKg}kg` : ''}

Generate optimal weekly set volume targets per muscle group.`;

  const result = await aiChatCompletion(fastify, userId, SYSTEM_PROMPT, userPrompt, {
    tier: 'light',
    maxTokens: 800,
    temperature: 0.2,
  });

  let volumeTargets: any;
  try {
    volumeTargets = JSON.parse(result.content);
  } catch {
    logger.error({ content: result.content.slice(0, 300) }, 'Failed to parse AI training goal response');
    throw new Error('AI returned invalid JSON for training goal');
  }

  const reasoning = volumeTargets.notes ?? `${primaryGoal} program with ${weeklyFrequency}x/week frequency.`;
  delete volumeTargets.notes;

  // Deactivate existing goals
  await fastify.prisma.trainingGoal.updateMany({
    where: { userId, isActive: true },
    data: { isActive: false },
  });

  return fastify.prisma.trainingGoal.create({
    data: {
      userId,
      primaryGoal,
      weeklyFrequency,
      volumeTargets: { weeklySetTargets: volumeTargets.weeklySetTargets ?? volumeTargets },
      reasoning,
      inputSnapshot: input as any,
      aiModel: result.model,
      isActive: true,
    },
  });
}

export async function getActiveTrainingGoal(fastify: FastifyInstance, userId: string) {
  return fastify.prisma.trainingGoal.findFirst({
    where: { userId, isActive: true },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getTrainingGoals(fastify: FastifyInstance, userId: string) {
  return fastify.prisma.trainingGoal.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
}
