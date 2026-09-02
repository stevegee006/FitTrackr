-- Remember whether an exercise is logged as cardio (time/distance) or strength
-- (weight/reps), per user. NULL means "infer", which preserves the previous
-- behaviour for every existing row.
ALTER TABLE "exercise_preferences" ADD COLUMN "is_cardio" BOOLEAN;
