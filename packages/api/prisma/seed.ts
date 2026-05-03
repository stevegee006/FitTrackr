import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const exercises = [
  // Chest
  { name: 'Barbell Bench Press', category: 'COMPOUND' as const, primaryMuscle: 'CHEST' as const, secondaryMuscles: ['SHOULDERS', 'TRICEPS'] as const, equipment: 'BARBELL' as const, instructions: 'Lie flat on a bench. Grip the barbell slightly wider than shoulder-width. Lower to chest, press up to lockout.' },
  { name: 'Incline Dumbbell Press', category: 'COMPOUND' as const, primaryMuscle: 'CHEST' as const, secondaryMuscles: ['SHOULDERS', 'TRICEPS'] as const, equipment: 'DUMBBELL' as const, instructions: 'Set bench to 30-45°. Press dumbbells from chest to lockout.' },
  { name: 'Cable Chest Fly', category: 'ISOLATION' as const, primaryMuscle: 'CHEST' as const, secondaryMuscles: [] as const, equipment: 'CABLE' as const, instructions: 'Stand between cables. With slight elbow bend, bring handles together in front of chest.' },
  { name: 'Push-Up', category: 'COMPOUND' as const, primaryMuscle: 'CHEST' as const, secondaryMuscles: ['SHOULDERS', 'TRICEPS'] as const, equipment: 'BODYWEIGHT' as const, instructions: 'Place hands shoulder-width apart. Lower chest to floor, press back up.' },
  // Back
  { name: 'Barbell Deadlift', category: 'COMPOUND' as const, primaryMuscle: 'BACK' as const, secondaryMuscles: ['GLUTES', 'HAMSTRINGS', 'CORE'] as const, equipment: 'BARBELL' as const, instructions: 'Stand with bar over mid-foot. Hinge at hips, grip bar, drive through floor to stand.' },
  { name: 'Pull-Up', category: 'COMPOUND' as const, primaryMuscle: 'BACK' as const, secondaryMuscles: ['BICEPS'] as const, equipment: 'BODYWEIGHT' as const, instructions: 'Hang from bar with overhand grip. Pull chin over bar, lower under control.' },
  { name: 'Seated Cable Row', category: 'COMPOUND' as const, primaryMuscle: 'BACK' as const, secondaryMuscles: ['BICEPS'] as const, equipment: 'CABLE' as const, instructions: 'Sit at cable row machine. Pull handle to midsection, squeeze shoulder blades.' },
  { name: 'Dumbbell Row', category: 'COMPOUND' as const, primaryMuscle: 'BACK' as const, secondaryMuscles: ['BICEPS'] as const, equipment: 'DUMBBELL' as const, instructions: 'Place one knee on bench. Row dumbbell to hip, keep elbow close.' },
  { name: 'Lat Pulldown', category: 'COMPOUND' as const, primaryMuscle: 'BACK' as const, secondaryMuscles: ['BICEPS'] as const, equipment: 'CABLE' as const, instructions: 'Grip bar wider than shoulders. Pull to upper chest, control the return.' },
  // Shoulders
  { name: 'Overhead Press', category: 'COMPOUND' as const, primaryMuscle: 'SHOULDERS' as const, secondaryMuscles: ['TRICEPS', 'CORE'] as const, equipment: 'BARBELL' as const, instructions: 'Stand with bar at shoulder height. Press overhead to lockout, lower under control.' },
  { name: 'Dumbbell Lateral Raise', category: 'ISOLATION' as const, primaryMuscle: 'SHOULDERS' as const, secondaryMuscles: [] as const, equipment: 'DUMBBELL' as const, instructions: 'With slight elbow bend, raise dumbbells out to shoulder height. Control the descent.' },
  { name: 'Face Pull', category: 'ISOLATION' as const, primaryMuscle: 'SHOULDERS' as const, secondaryMuscles: ['BACK'] as const, equipment: 'CABLE' as const, instructions: 'Pull rope to face with elbows flared wide and high.' },
  // Biceps
  { name: 'Barbell Curl', category: 'ISOLATION' as const, primaryMuscle: 'BICEPS' as const, secondaryMuscles: [] as const, equipment: 'BARBELL' as const, instructions: 'Stand with barbell. Curl to shoulder height keeping elbows fixed.' },
  { name: 'Dumbbell Hammer Curl', category: 'ISOLATION' as const, primaryMuscle: 'BICEPS' as const, secondaryMuscles: ['FOREARMS'] as const, equipment: 'DUMBBELL' as const, instructions: 'Hold dumbbells with neutral grip. Curl keeping palms facing each other.' },
  // Triceps
  { name: 'Tricep Pushdown', category: 'ISOLATION' as const, primaryMuscle: 'TRICEPS' as const, secondaryMuscles: [] as const, equipment: 'CABLE' as const, instructions: 'Push cable handle down until arms fully extended, elbows at sides.' },
  { name: 'Close-Grip Bench Press', category: 'COMPOUND' as const, primaryMuscle: 'TRICEPS' as const, secondaryMuscles: ['CHEST', 'SHOULDERS'] as const, equipment: 'BARBELL' as const, instructions: 'Grip barbell shoulder-width. Press with elbows tucked close to body.' },
  { name: 'Skull Crusher', category: 'ISOLATION' as const, primaryMuscle: 'TRICEPS' as const, secondaryMuscles: [] as const, equipment: 'BARBELL' as const, instructions: 'Lie on bench. Lower barbell to forehead keeping elbows fixed, press back up.' },
  // Legs
  { name: 'Barbell Back Squat', category: 'COMPOUND' as const, primaryMuscle: 'QUADS' as const, secondaryMuscles: ['GLUTES', 'HAMSTRINGS', 'CORE'] as const, equipment: 'BARBELL' as const, instructions: 'Bar on upper back. Squat to parallel or below, drive through heels to stand.' },
  { name: 'Romanian Deadlift', category: 'COMPOUND' as const, primaryMuscle: 'HAMSTRINGS' as const, secondaryMuscles: ['GLUTES', 'BACK'] as const, equipment: 'BARBELL' as const, instructions: 'Hinge at hips with soft knees, lower bar along legs until hamstrings are stretched. Drive hips forward to return.' },
  { name: 'Leg Press', category: 'COMPOUND' as const, primaryMuscle: 'QUADS' as const, secondaryMuscles: ['GLUTES', 'HAMSTRINGS'] as const, equipment: 'MACHINE' as const, instructions: 'Push platform away, lower under control until 90° knee bend.' },
  { name: 'Hip Thrust', category: 'COMPOUND' as const, primaryMuscle: 'GLUTES' as const, secondaryMuscles: ['HAMSTRINGS'] as const, equipment: 'BARBELL' as const, instructions: 'Upper back on bench, bar across hips. Drive hips up to lockout, squeeze glutes.' },
  { name: 'Leg Curl', category: 'ISOLATION' as const, primaryMuscle: 'HAMSTRINGS' as const, secondaryMuscles: [] as const, equipment: 'MACHINE' as const, instructions: 'Lie face down, curl ankles to glutes, lower under control.' },
  { name: 'Leg Extension', category: 'ISOLATION' as const, primaryMuscle: 'QUADS' as const, secondaryMuscles: [] as const, equipment: 'MACHINE' as const, instructions: 'Extend legs to lockout, lower under control.' },
  { name: 'Calf Raise', category: 'ISOLATION' as const, primaryMuscle: 'CALVES' as const, secondaryMuscles: [] as const, equipment: 'MACHINE' as const, instructions: 'Rise onto toes, hold briefly, lower below starting position.' },
  // Core
  { name: 'Plank', category: 'OTHER' as const, primaryMuscle: 'CORE' as const, secondaryMuscles: [] as const, equipment: 'BODYWEIGHT' as const, instructions: 'Hold straight body position on forearms and toes.' },
  { name: 'Cable Crunch', category: 'ISOLATION' as const, primaryMuscle: 'CORE' as const, secondaryMuscles: [] as const, equipment: 'CABLE' as const, instructions: 'Kneel at cable. Crunch torso toward knees keeping hips still.' },
];

async function main() {
  console.log('Seeding exercise library...');
  let count = 0;
  for (const ex of exercises) {
    await prisma.exercise.upsert({
      where: { id: `00000000-0000-0000-0000-${String(count + 1).padStart(12, '0')}` },
      update: {},
      create: {
        id: `00000000-0000-0000-0000-${String(count + 1).padStart(12, '0')}`,
        name: ex.name,
        category: ex.category,
        primaryMuscle: ex.primaryMuscle,
        secondaryMuscles: ex.secondaryMuscles as any,
        equipment: ex.equipment,
        instructions: ex.instructions,
        source: 'MANUAL',
        isCustom: false,
      },
    });
    count++;
  }
  console.log(`Seeded ${count} exercises.`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
