import type { MuscleGroup, WorkoutType } from '@fittrackr/shared';

export interface InferredExerciseDetails {
  primaryMuscle: MuscleGroup;
  equipment: string;
  category: string;
}

/**
 * Guess an exercise's muscle, equipment and category from its NAME.
 *
 * Used only when hydrating AI output into real library exercises: the model is
 * asked for these fields and usually supplies them, so this is the fallback for
 * when it doesn't. Never used for anything the user typed — a wrong guess there
 * would be silently mistagging their own data.
 *
 * This lived in TWO copies, in workouts/page.tsx and programs/page.tsx, and had
 * already drifted: the programs copy knew about pushdowns, leg curls, forearms
 * and trap-bar deadlifts while the workouts copy did not, so the same AI
 * response hydrated differently depending on which screen produced it. This is
 * the better of the two, plus the muscle groups added since.
 *
 * ORDER IS LOAD-BEARING. Every rule is a substring test, so a broader pattern
 * placed first swallows a narrower one. The traps that are easy to reintroduce:
 *
 *  - `' ab'` (for abs) matches "hip ABductor", so hip abduction must be tested
 *    BEFORE core.
 *  - `'lat'` matches "LATeral raise", so shoulders must be tested before lats.
 *  - `'trap'` matches "TRAP bar deadlift", which is a deadlift, not a shrug.
 *  - `'adductor'` and `'abductor'` differ by one letter; both are tested.
 */
export function inferExerciseDetails(name: string, workoutType: WorkoutType): InferredExerciseDetails {
  const n = name.toLowerCase();

  // Equipment
  let equipment = 'BODYWEIGHT';
  if (n.includes('barbell')) equipment = 'BARBELL';
  else if (n.includes('dumbbell')) equipment = 'DUMBBELL';
  else if (n.includes('cable')) equipment = 'CABLE';
  else if (n.includes('machine') || n.includes('smith')) equipment = 'MACHINE';
  else if (n.includes('kettlebell')) equipment = 'KETTLEBELL';
  else if (n.includes('band') || n.includes('resistance')) equipment = 'BANDS';

  // Category
  const compoundKw = ['press', 'squat', 'deadlift', 'row', 'pull', 'dip', 'lunge', 'clean', 'snatch', 'thrust'];
  const category = compoundKw.some((kw) => n.includes(kw)) ? 'COMPOUND' : 'ISOLATION';

  // Primary muscle
  let primaryMuscle: MuscleGroup = 'FULL_BODY';
  if (n.includes('chest') || n.includes('pec') || n.includes('fly') || n.includes('flye') ||
      (n.includes('bench') && !n.includes('row'))) {
    primaryMuscle = 'CHEST';
  } else if (n.includes('tricep') || n.includes('pushdown') ||
      (n.includes('extension') && !n.includes('leg') && !n.includes('back'))) {
    primaryMuscle = 'TRICEPS';
  } else if (n.includes('bicep') || n.includes('biceps') ||
      // 'leg curl' is hamstrings and 'wrist curl' is forearms — both reach this
      // rule before their own, so both have to be excluded here.
      (n.includes('curl') && !n.includes('leg') && !n.includes('ham') && !n.includes('wrist'))) {
    primaryMuscle = 'BICEPS';
  } else if (n.includes('shoulder') || n.includes('delt') || n.includes('lateral raise') ||
      n.includes('overhead press') || n.includes('military')) {
    primaryMuscle = 'SHOULDERS';
  } else if (n.includes('shrug') || (n.includes('trap') && !n.includes('trap bar'))) {
    primaryMuscle = 'TRAPS';
  } else if (n.includes('lat ') || n.includes('lats') || n.includes('pulldown') ||
      n.includes('pullover')) {
    primaryMuscle = 'LATS';
  } else if (n.includes(' row') || n.includes('pull-up') || n.includes('pullup') || n.includes('back') ||
      (n.includes('deadlift') && !n.includes('romanian') && !n.includes('rdl'))) {
    primaryMuscle = 'BACK';
  } else if (n.includes('adductor') || n.includes('adduction')) {
    primaryMuscle = 'ADDUCTORS';
  } else if (n.includes('abductor') || n.includes('abduction')) {
    primaryMuscle = 'ABDUCTORS';
  } else if (n.includes('quad') || n.includes('squat') || n.includes('leg press') || n.includes('lunge')) {
    primaryMuscle = 'QUADS';
  } else if (n.includes('hamstring') || n.includes('rdl') || n.includes('romanian') || n.includes('leg curl')) {
    primaryMuscle = 'HAMSTRINGS';
  } else if (n.includes('glute') || n.includes('hip thrust') || n.includes('hip hinge')) {
    primaryMuscle = 'GLUTES';
  } else if (n.includes('calf') || n.includes('calves') || n.includes('gastrocnemius')) {
    primaryMuscle = 'CALVES';
  } else if (n.includes('oblique') || n.includes('side bend') || n.includes('russian twist') ||
      n.includes('woodchop') || n.includes('wood chop')) {
    primaryMuscle = 'OBLIQUES';
  } else if (n.includes('core') || n.includes(' ab') || n.includes('crunch') || n.includes('plank') ||
      n.includes('sit-up') || n.includes('situp')) {
    primaryMuscle = 'CORE';
  } else if (n.includes('forearm') || n.includes('wrist')) {
    primaryMuscle = 'FOREARMS';
  } else {
    // Fall back to primary muscle for the workout type
    const typeMap: Partial<Record<WorkoutType, MuscleGroup>> = {
      PUSH: 'CHEST', PULL: 'BACK', LEGS: 'QUADS',
      UPPER: 'CHEST', LOWER: 'QUADS', FULL_BODY: 'FULL_BODY',
    };
    primaryMuscle = typeMap[workoutType] ?? 'FULL_BODY';
  }

  return { primaryMuscle, equipment, category };
}
