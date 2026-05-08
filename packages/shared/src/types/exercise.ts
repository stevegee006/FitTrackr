export type ExerciseCategory = 'COMPOUND' | 'ISOLATION' | 'CARDIO' | 'STRETCHING' | 'OTHER';
export type MuscleGroup = 'CHEST' | 'BACK' | 'SHOULDERS' | 'BICEPS' | 'TRICEPS' | 'FOREARMS' | 'QUADS' | 'HAMSTRINGS' | 'GLUTES' | 'CALVES' | 'CORE' | 'FULL_BODY';
export type Equipment = 'BARBELL' | 'DUMBBELL' | 'CABLE' | 'MACHINE' | 'BODYWEIGHT' | 'KETTLEBELL' | 'BANDS' | 'OTHER';
export type ExerciseSource = 'WGER' | 'MANUAL' | 'AI_INGEST';
export type WorkoutType = 'PUSH' | 'PULL' | 'LEGS' | 'UPPER' | 'LOWER' | 'FULL_BODY' | 'CARDIO' | 'CUSTOM';
export type RecordType = 'MAX_WEIGHT' | 'MAX_REPS' | 'MAX_1RM' | 'MAX_VOLUME';
export type TrainingGoalType = 'STRENGTH' | 'HYPERTROPHY' | 'ENDURANCE' | 'WEIGHT_LOSS' | 'GENERAL_FITNESS';

export interface Exercise {
  id: string;
  name: string;
  category: ExerciseCategory;
  primaryMuscle: MuscleGroup;
  secondaryMuscles: MuscleGroup[];
  equipment: Equipment;
  instructions: string | null;
  videoUrl: string | null;
  imageUrl: string | null;
  source: ExerciseSource;
  isCustom: boolean;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkoutSet {
  id: string;
  workoutId: string;
  exerciseId: string;
  exercise?: Pick<Exercise, 'id' | 'name' | 'primaryMuscle' | 'equipment'>;
  setNumber: number;
  reps: number | null;
  weightKg: number | null;
  bodyweightKg: number | null;
  durationSec: number | null;
  distanceM: number | null;
  rpe: number | null;
  isWarmup: boolean;
  supersetGroupId?: string | null;
  notes: string | null;
  createdAt: string;
}

export interface Workout {
  id: string;
  userId: string;
  name: string | null;
  logDate: string;
  durationMin: number | null;
  workoutType: WorkoutType;
  notes: string | null;
  sets?: WorkoutSet[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkoutTemplate {
  id: string;
  userId: string;
  name: string;
  workoutType: WorkoutType;
  templateData: WorkoutTemplateData;
  createdAt: string;
  updatedAt: string;
}

export interface WorkoutTemplateData {
  exercises: Array<{
    exerciseId: string;
    exerciseName: string;
    sets: number;
    reps?: number;
    weightKg?: number;
    notes?: string;
  }>;
}

export interface Program {
  id: string;
  userId: string;
  name: string;
  durationWeeks: number;
  programData: ProgramData;
  aiModel: string;
  isActive: boolean;
  createdAt: string;
}

export interface ProgramData {
  weeks: Array<{
    weekNumber: number;
    days: Array<{
      dayOfWeek: number; // 1=Mon … 7=Sun
      workoutType: WorkoutType;
      focus: string;
      exercises: Array<{
        name: string;
        sets: number;
        reps: string; // e.g. "8-10"
        rpe?: number;
        notes?: string;
        primaryMuscle?: string; // e.g. "CHEST"
        equipment?: string;     // e.g. "BARBELL"
        category?: string;      // e.g. "COMPOUND"
      }>;
    }>;
  }>;
  notes?: string;
}

export interface TrainingGoal {
  id: string;
  userId: string;
  primaryGoal: TrainingGoalType;
  weeklyFrequency: number;
  volumeTargets: VolumeTargets;
  reasoning: string;
  inputSnapshot: Record<string, unknown>;
  aiModel: string;
  isActive: boolean;
  createdAt: string;
}

export interface VolumeTargets {
  weeklySetTargets: Partial<Record<MuscleGroup, number>>;
  notes?: string;
}

export interface PersonalRecord {
  id: string;
  userId: string;
  exerciseId: string;
  exercise?: Pick<Exercise, 'id' | 'name'>;
  recordType: RecordType;
  value: number;
  setId: string | null;
  achievedAt: string;
  createdAt: string;
}

export interface WeeklyVolumeSummary {
  muscleGroup: MuscleGroup;
  totalSets: number;
  targetSets: number | null;
}

export interface WorkoutSummary {
  totalWorkouts: number;
  totalSets: number;
  totalVolumeKg: number;
  volumeByMuscle: Partial<Record<MuscleGroup, number>>;
}

export interface ParsedExercise {
  name: string;
  category: ExerciseCategory;
  primaryMuscle: MuscleGroup;
  secondaryMuscles: MuscleGroup[];
  equipment: Equipment;
  instructions: string | null;
}
