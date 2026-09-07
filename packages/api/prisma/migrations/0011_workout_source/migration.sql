-- Workouts recorded elsewhere and imported from HealthKit.
--
-- `source` defaults to MANUAL so every existing row keeps its meaning: they
-- were all logged in FitTrackr. Only imports carry HEALTHKIT.
--
-- Imported workouts DO count as workout days — the weekly frequency ring and
-- the streak both include them, and they cannot be separated, because the
-- streak is defined as weeks that met the frequency goal. Per-muscle volume
-- targets are unaffected regardless: those count sets, and an imported workout
-- has none. The column exists to LABEL these rows in the UI and to keep the
-- upsert idempotent, not to hide them.
--
-- `external_id` is the HKWorkout UUID and is what makes importing idempotent:
-- the phone can re-send the same rolling window on every app open and the
-- upsert simply refreshes. Unique per USER, not globally, because two users
-- can legitimately import the same shared workout.
--
-- Note the partial-unique behaviour Postgres gives for free here: NULLs are
-- not equal to each other, so every manually logged workout keeps external_id
-- NULL without colliding.
CREATE TYPE "WorkoutSource" AS ENUM ('MANUAL', 'HEALTHKIT');

ALTER TABLE "workouts" ADD COLUMN "source" "WorkoutSource" NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "workouts" ADD COLUMN "external_id" VARCHAR(64);
ALTER TABLE "workouts" ADD COLUMN "distance_m" DOUBLE PRECISION;

CREATE UNIQUE INDEX "workouts_user_id_external_id_key" ON "workouts"("user_id", "external_id");
