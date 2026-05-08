-- AlterTable: add superset_group_id to workout_sets for grouping exercises into supersets/circuits
ALTER TABLE "workout_sets" ADD COLUMN "superset_group_id" UUID;
