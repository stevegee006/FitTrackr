import type { FastifyInstance } from 'fastify';
import type { UpdateProfileInput, UpdateSettingsInput } from '@fittrackr/shared';
import { NotFoundError, ValidationError } from '../utils/errors.js';
import { encrypt } from '../utils/encryption.js';

function calculateAge(birthDate: Date): number {
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}

export async function getUser(fastify: FastifyInstance, userId: string) {
  const user = await fastify.prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      displayName: true,
      avatarUrl: true,
      authProvider: true,
      isAdmin: true,
      mustChangePassword: true,
      createdAt: true,
    },
  });
  if (!user) throw new NotFoundError('User');
  return user;
}

export async function updateUser(
  fastify: FastifyInstance,
  userId: string,
  data: { displayName?: string; avatarUrl?: string },
) {
  return fastify.prisma.user.update({
    where: { id: userId },
    data,
    select: {
      id: true,
      email: true,
      displayName: true,
      avatarUrl: true,
      authProvider: true,
      isAdmin: true,
      mustChangePassword: true,
      createdAt: true,
    },
  });
}

export async function getProfile(fastify: FastifyInstance, userId: string) {
  const profile = await fastify.prisma.userProfile.findUnique({ where: { userId } });
  if (!profile) throw new NotFoundError('User profile');
  // Auto-compute age from birthDate if set
  if (profile.birthDate) {
    return { ...profile, age: calculateAge(profile.birthDate) };
  }
  return profile;
}

export async function updateProfile(
  fastify: FastifyInstance,
  userId: string,
  data: UpdateProfileInput,
) {
  const writeData: Record<string, unknown> = { ...data };

  // Convert birthDate string to Date and compute age
  if (data.birthDate !== undefined) {
    if (data.birthDate) {
      const bd = new Date(data.birthDate + 'T00:00:00Z');
      writeData.birthDate = bd;
      writeData.age = calculateAge(bd);
    } else {
      writeData.birthDate = null;
    }
  }

  return fastify.prisma.userProfile.upsert({
    where: { userId },
    update: writeData,
    create: { userId, ...writeData },
  });
}

export async function getSettings(fastify: FastifyInstance, userId: string) {
  const settings = await fastify.prisma.userSettings.findUnique({ where: { userId } });
  if (!settings) throw new NotFoundError('User settings');
  return {
    id: settings.id,
    userId: settings.userId,
    hasOpenaiKey: !!settings.openaiApiKey,
    hasAnthropicKey: !!settings.anthropicApiKey,
    hasGeminiKey: !!settings.geminiApiKey,
    aiProvider: settings.aiProvider,
    hasExerciseApiKey: !!settings.exerciseApiKey,
    preferredUnits: settings.preferredUnits,
    darkMode: settings.darkMode,
    timezone: settings.timezone,
    location: settings.location,
  };
}

export async function updateSettings(
  fastify: FastifyInstance,
  userId: string,
  data: UpdateSettingsInput,
) {
  const updateData: Record<string, unknown> = {};
  if (data.preferredUnits !== undefined) updateData.preferredUnits = data.preferredUnits;
  if (data.darkMode !== undefined) updateData.darkMode = data.darkMode;
  if (data.openaiApiKey !== undefined) {
    updateData.openaiApiKey = encrypt(data.openaiApiKey);
  }
  if (data.anthropicApiKey !== undefined) {
    updateData.anthropicApiKey = encrypt(data.anthropicApiKey);
  }
  if (data.geminiApiKey !== undefined) {
    updateData.geminiApiKey = encrypt(data.geminiApiKey);
  }
  if (data.aiProvider !== undefined) {
    updateData.aiProvider = data.aiProvider;
  }
  if (data.timezone !== undefined) {
    if (data.timezone !== null) {
      try {
        Intl.DateTimeFormat(undefined, { timeZone: data.timezone });
      } catch {
        throw new ValidationError('Invalid timezone identifier');
      }
    }
    updateData.timezone = data.timezone;
  }
  if (data.location !== undefined) {
    updateData.location = data.location?.trim() || null;
  }
  if ((data as any).exerciseApiKey !== undefined) {
    updateData.exerciseApiKey = encrypt((data as any).exerciseApiKey);
  }

  const settings = await fastify.prisma.userSettings.upsert({
    where: { userId },
    update: updateData,
    create: { userId, ...updateData },
  });

  return {
    id: settings.id,
    userId: settings.userId,
    hasOpenaiKey: !!settings.openaiApiKey,
    hasAnthropicKey: !!settings.anthropicApiKey,
    hasGeminiKey: !!settings.geminiApiKey,
    aiProvider: settings.aiProvider,
    hasExerciseApiKey: !!settings.exerciseApiKey,
    preferredUnits: settings.preferredUnits,
    darkMode: settings.darkMode,
    timezone: settings.timezone,
    location: settings.location,
  };
}
