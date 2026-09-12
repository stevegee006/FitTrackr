-- Remember the rest duration per exercise, per user. A heavy squat wants three
-- minutes and a cable fly wants forty-five seconds, and re-picking it every set
-- is the kind of friction that stops the timer being used at all.
--
-- NULL means "no preference", which is every existing row: the timer then falls
-- back to the single global value in localStorage, the previous behaviour.
ALTER TABLE "exercise_preferences" ADD COLUMN "rest_seconds" INTEGER;
