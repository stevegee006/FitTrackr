CREATE TABLE "exercise_preferences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "exercise_id" UUID NOT NULL,
    "rep_range_min" INTEGER,
    "rep_range_max" INTEGER,
    "target_sets" INTEGER,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "exercise_preferences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "exercise_preferences_user_id_exercise_id_key" ON "exercise_preferences"("user_id", "exercise_id");
CREATE INDEX "exercise_preferences_user_id_idx" ON "exercise_preferences"("user_id");

ALTER TABLE "exercise_preferences" ADD CONSTRAINT "exercise_preferences_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "exercise_preferences" ADD CONSTRAINT "exercise_preferences_exercise_id_fkey"
    FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE CASCADE ON UPDATE CASCADE;
