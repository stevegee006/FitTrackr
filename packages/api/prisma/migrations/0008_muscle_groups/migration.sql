-- Five muscle groups the library could not express. The immediate cause: a
-- machine hip adductor had to be filed under HAMSTRINGS, and a hip abductor
-- under GLUTES, so per-muscle volume was attributed to the wrong leg muscle.
--
-- Additive only, and no existing row changes — re-tagging the affected
-- exercises is a manual pass in Admin -> Exercises with the new editor.
--
-- `ADD VALUE` appends, so these land at the end of the type's sort order;
-- schema.prisma lists them in the same position for that reason. Postgres 12+
-- allows ADD VALUE inside a transaction (which is how Prisma runs a migration)
-- as long as the new value is not USED in that same transaction — nothing here
-- does, so this applies cleanly through `prisma migrate deploy`.
ALTER TYPE "MuscleGroup" ADD VALUE IF NOT EXISTS 'LATS';
ALTER TYPE "MuscleGroup" ADD VALUE IF NOT EXISTS 'TRAPS';
ALTER TYPE "MuscleGroup" ADD VALUE IF NOT EXISTS 'ADDUCTORS';
ALTER TYPE "MuscleGroup" ADD VALUE IF NOT EXISTS 'ABDUCTORS';
ALTER TYPE "MuscleGroup" ADD VALUE IF NOT EXISTS 'OBLIQUES';
