import type { FastifyInstance } from 'fastify';

interface CsvRow {
  date: string;
  exercise: string;
  reps: number;
  weightKg: number;
  durationSec: number;
  distanceM: number;
  isWarmup: boolean;
  note: string;
}

export interface ImportSummary {
  workoutsCreated: number;
  setsCreated: number;
  exercisesCreated: number;
  skipped: number;
}

function parseCsvRows(csvText: string): CsvRow[] {
  const lines = csvText.split('\n');
  const rows: CsvRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const parts = line.split(',');
    if (parts.length < 11) continue;

    // Date field: "2026-05-01 23:15:15 +0000" — may contain spaces, not commas
    // Layout: Date,Exercise,Reps,Weight(kg),Duration(s),Distance(m),Incline,Resistance,isWarmup,Note,multiplier
    // Date is first field, Exercise is second, rest are numeric/bool/string
    const date = parts[0].trim();
    const exercise = parts[1].trim();
    const reps = parseFloat(parts[2].trim()) || 0;
    const weightKg = parseFloat(parts[3].trim()) || 0;
    const durationSec = parseFloat(parts[4].trim()) || 0;
    const distanceM = parseFloat(parts[5].trim()) || 0;
    // parts[6] = Incline, parts[7] = Resistance (ignored)
    const isWarmup = parts[8].trim().toLowerCase() === 'true';
    const note = parts[9].trim();
    // parts[10] = multiplier (ignored)

    if (!date || !exercise) continue;

    rows.push({ date, exercise, reps, weightKg, durationSec, distanceM, isWarmup, note });
  }

  return rows;
}

function inferWorkoutType(muscles: string[]): string {
  const counts: Record<string, number> = {};
  for (const m of muscles) {
    counts[m] = (counts[m] ?? 0) + 1;
  }

  const push = (counts['CHEST'] ?? 0) + (counts['SHOULDERS'] ?? 0) + (counts['TRICEPS'] ?? 0);
  const pull = (counts['BACK'] ?? 0) + (counts['BICEPS'] ?? 0);
  const legs = (counts['QUADS'] ?? 0) + (counts['HAMSTRINGS'] ?? 0) + (counts['GLUTES'] ?? 0) + (counts['CALVES'] ?? 0);
  const cardio = (counts['FULL_BODY'] ?? 0);

  const max = Math.max(push, pull, legs, cardio);
  if (max === 0) return 'CUSTOM';
  if (cardio === max) return 'CARDIO';
  if (push === max) return 'PUSH';
  if (pull === max) return 'PULL';
  if (legs === max) return 'LEGS';
  return 'CUSTOM';
}

export async function importWorkoutsFromCsv(
  fastify: FastifyInstance,
  userId: string,
  csvText: string,
): Promise<ImportSummary> {
  const rows = parseCsvRows(csvText);

  const sessionMap = new Map<string, CsvRow[]>();
  for (const row of rows) {
    const group = sessionMap.get(row.date) ?? [];
    group.push(row);
    sessionMap.set(row.date, group);
  }

  let workoutsCreated = 0;
  let setsCreated = 0;
  let exercisesCreated = 0;
  let skipped = 0;

  for (const [dateStr, sessionRows] of sessionMap) {
    const parsedDate = new Date(dateStr);
    if (isNaN(parsedDate.getTime())) {
      skipped++;
      continue;
    }

    const logDate = parsedDate.toISOString().slice(0, 10);

    const existing = await fastify.prisma.workout.findFirst({
      where: { userId, logDate },
      select: { id: true },
    });

    if (existing) {
      skipped++;
      continue;
    }

    await fastify.prisma.$transaction(async (tx) => {
      const exerciseNames = sessionRows.map((r) => r.exercise);
      const resolvedMuscles: string[] = [];

      const exerciseIdMap = new Map<string, string>();

      for (const name of exerciseNames) {
        if (exerciseIdMap.has(name)) continue;

        let ex = await tx.exercise.findFirst({
          where: { name: { equals: name, mode: 'insensitive' } },
          select: { id: true, primaryMuscle: true },
        });

        if (!ex) {
          ex = await tx.exercise.create({
            data: {
              name,
              category: 'OTHER',
              primaryMuscle: 'FULL_BODY',
              equipment: 'OTHER',
              source: 'MANUAL',
              isCustom: false,
              secondaryMuscles: [],
            },
            select: { id: true, primaryMuscle: true },
          });
          exercisesCreated++;
        }

        exerciseIdMap.set(name, ex.id);
        resolvedMuscles.push(ex.primaryMuscle);
      }

      const workoutType = inferWorkoutType(resolvedMuscles);

      const workout = await tx.workout.create({
        data: {
          userId,
          logDate,
          workoutType,
        },
        select: { id: true },
      });

      workoutsCreated++;

      for (let i = 0; i < sessionRows.length; i++) {
        const row = sessionRows[i];
        const exerciseId = exerciseIdMap.get(row.exercise)!;

        await tx.workoutSet.create({
          data: {
            workoutId: workout.id,
            exerciseId,
            setNumber: i + 1,
            reps: row.reps > 0 ? row.reps : null,
            weightKg: row.weightKg > 0 ? row.weightKg : null,
            durationSec: row.durationSec > 0 ? row.durationSec : null,
            distanceM: row.distanceM > 0 ? row.distanceM : null,
            isWarmup: row.isWarmup,
            notes: row.note || null,
          },
        });

        setsCreated++;
      }
    });
  }

  return { workoutsCreated, setsCreated, exercisesCreated, skipped };
}
