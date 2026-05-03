import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  rememberMe: z.boolean().optional(),
});

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  displayName: z.string().min(1).max(100).optional(),
});

export const updateProfileSchema = z.object({
  heightCm: z.number().positive().max(300).nullable().optional(),
  weightKg: z.number().positive().max(500).nullable().optional(),
  age: z.number().int().positive().max(150).nullable().optional(),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  sex: z.enum(['MALE', 'FEMALE', 'OTHER']).nullable().optional(),
  activityLevel: z
    .enum(['SEDENTARY', 'LIGHTLY_ACTIVE', 'MODERATELY_ACTIVE', 'VERY_ACTIVE', 'EXTREMELY_ACTIVE'])
    .nullable()
    .optional(),
  goal: z.enum(['LOSE_WEIGHT', 'MAINTAIN', 'GAIN_MUSCLE']).nullable().optional(),
  targetCalories: z.number().int().positive().max(10000).nullable().optional(),
  targetProteinG: z.number().int().nonnegative().max(1000).nullable().optional(),
  targetCarbsG: z.number().int().nonnegative().max(2000).nullable().optional(),
  targetFatG: z.number().int().nonnegative().max(1000).nullable().optional(),
});

export const updateSettingsSchema = z.object({
  openaiApiKey: z.string().min(1).max(500).optional(),
  anthropicApiKey: z.string().min(1).max(500).optional(),
  geminiApiKey: z.string().min(1).max(500).optional(),
  aiProvider: z.enum(['OPENAI', 'ANTHROPIC', 'GEMINI']).optional(),
  preferredUnits: z.enum(['METRIC', 'IMPERIAL']).optional(),
  darkMode: z.boolean().optional(),
  timezone: z.string().min(1).max(100).nullable().optional(),
  location: z.string().max(255).nullable().optional(),
  mealieUrl: z.string().url().max(500).nullable().optional(),
  mealieApiKey: z.string().min(1).max(500).optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

export const adminCreateUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  displayName: z.string().min(1).max(100).optional(),
});

export const appSettingsSchema = z.object({
  signupsEnabled: z.boolean().optional(),
  usdaApiKey: z.string().max(100).optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export const updateUserSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  avatarUrl: z.string().url().max(2000).optional(),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1).max(200),
});

export const adminListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  q: z.string().max(200).optional(),
});

export const regenerateMealSchema = z.object({
  dayNumber: z.number().int().nonnegative(),
  mealIndex: z.number().int().nonnegative(),
});

export const convertRecipeSchema = z.object({
  mealType: z.enum(['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK']).default('DINNER'),
});

export const createBodyMeasurementSchema = z.object({
  measuredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  waist: z.number().positive().max(500).nullable().optional(),
  hip: z.number().positive().max(500).nullable().optional(),
  abdomen: z.number().positive().max(500).nullable().optional(),
  chest: z.number().positive().max(500).nullable().optional(),
  thighR: z.number().positive().max(200).nullable().optional(),
  thighL: z.number().positive().max(200).nullable().optional(),
  bicepR: z.number().positive().max(100).nullable().optional(),
  bicepL: z.number().positive().max(100).nullable().optional(),
  neck: z.number().positive().max(100).nullable().optional(),
  calfR: z.number().positive().max(100).nullable().optional(),
  calfL: z.number().positive().max(100).nullable().optional(),
  shoulder: z.number().positive().max(300).nullable().optional(),
  weightKg: z.number().positive().max(500).nullable().optional(),
  bodyFatPct: z.number().positive().max(100).nullable().optional(),
  leanMassKg: z.number().positive().max(500).nullable().optional(),
  notes: z.string().max(500).optional(),
});

export const measurementQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const measurementRangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const createProgressPhotoSchema = z.object({
  takenAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().max(500).optional(),
  image: z.string().min(1),
});

export const progressPhotoQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(20),
});

export type CreateBodyMeasurementInput = z.infer<typeof createBodyMeasurementSchema>;
export type CreateProgressPhotoInput = z.infer<typeof createProgressPhotoSchema>;
export type AdminCreateUserInput = z.infer<typeof adminCreateUserSchema>;
export type AppSettingsInput = z.infer<typeof appSettingsSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type RegenerateMealInput = z.infer<typeof regenerateMealSchema>;
