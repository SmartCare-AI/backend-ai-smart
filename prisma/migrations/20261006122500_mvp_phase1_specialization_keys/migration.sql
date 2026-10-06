-- MVP Phase 1: specializations become lowercase keys shared with AI triage
-- (see src/doctors/specializations.ts). Free-text values are normalized so
-- search by key keeps matching existing doctors.
UPDATE "doctor_profiles" SET "specialization" = LOWER(TRIM("specialization"));
