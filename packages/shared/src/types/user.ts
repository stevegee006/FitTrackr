export type AuthProvider = 'LOCAL' | 'GOOGLE' | 'GITHUB' | 'SAML' | 'OIDC' | 'PASSKEY';
export type Sex = 'MALE' | 'FEMALE' | 'OTHER';
export type ActivityLevel =
  | 'SEDENTARY'
  | 'LIGHTLY_ACTIVE'
  | 'MODERATELY_ACTIVE'
  | 'VERY_ACTIVE'
  | 'EXTREMELY_ACTIVE';
export type Units = 'METRIC' | 'IMPERIAL';
export type AiProvider = 'OPENAI' | 'ANTHROPIC' | 'GEMINI';

export interface User {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  authProvider: AuthProvider;
  isAdmin: boolean;
  mustChangePassword: boolean;
  createdAt: string;
}

export interface UserProfile {
  id: string;
  userId: string;
  heightCm: number | null;
  weightKg: number | null;
  age: number | null;
  birthDate: string | null;
  sex: Sex | null;
  activityLevel: ActivityLevel | null;
  goal: import('./exercise.js').TrainingGoalType | null;
  weeklyFrequency: number | null;
}

export interface BodyMeasurement {
  id: string;
  userId: string;
  measuredAt: string;
  waist: number | null;
  hip: number | null;
  abdomen: number | null;
  chest: number | null;
  thighR: number | null;
  thighL: number | null;
  bicepR: number | null;
  bicepL: number | null;
  neck: number | null;
  calfR: number | null;
  calfL: number | null;
  shoulder: number | null;
  weightKg: number | null;
  bodyFatPct: number | null;
  leanMassKg: number | null;
  notes: string | null;
  createdAt: string;
}

export interface ProgressPhotoMeta {
  id: string;
  userId: string;
  takenAt: string;
  notes: string | null;
  createdAt: string;
}

export interface UserSettings {
  id: string;
  userId: string;
  hasOpenaiKey: boolean;
  hasAnthropicKey: boolean;
  hasGeminiKey: boolean;
  aiProvider: AiProvider;
  hasExerciseApiKey: boolean;
  preferredUnits: Units;
  darkMode: boolean;
  timezone: string | null;
  location: string | null;
}
