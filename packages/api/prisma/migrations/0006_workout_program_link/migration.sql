-- Link a workout back to the program day it came from, so program adherence
-- and the program summary can be measured. Nullable: ad-hoc workouts and every
-- workout logged before this migration have no program.
ALTER TABLE "workouts" ADD COLUMN "program_id" UUID;
ALTER TABLE "workouts" ADD COLUMN "program_week" INTEGER;
ALTER TABLE "workouts" ADD COLUMN "program_day" INTEGER;

CREATE INDEX "workouts_program_id_idx" ON "workouts"("program_id");

-- SET NULL rather than CASCADE: deleting a program must not delete the
-- workouts that were performed under it.
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_program_id_fkey"
  FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
