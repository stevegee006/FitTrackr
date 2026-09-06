-- Heart rate and active energy for a session, read back from HealthKit after
-- the Apple Watch saves it.
--
-- Nullable, and NULL is meaningful: it is "not recorded", not zero. Every
-- workout logged on the phone, and everything predating the watch app, has no
-- measurement at all — averaging those in as noughts would drag every summary
-- toward zero and make the numbers a lie.
--
-- Integers because the source precision does not survive the round trip
-- anyway: HealthKit gives a Double, but a heart rate of 138.4 bpm and an
-- energy of 412.7 kcal are false precision for a workout summary.
ALTER TABLE "workouts" ADD COLUMN "avg_heart_rate_bpm" INTEGER;
ALTER TABLE "workouts" ADD COLUMN "active_energy_kcal" INTEGER;
