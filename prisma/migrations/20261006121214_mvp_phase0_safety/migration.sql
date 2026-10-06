-- AlterTable
ALTER TABLE "assessments" ADD COLUMN     "aiEngine" TEXT;

-- AlterTable
ALTER TABLE "emergency_events" ADD COLUMN     "escalatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "patient_profiles" ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'Africa/Cairo';

-- CreateTable
CREATE TABLE "scheduler_locks" (
    "name" TEXT NOT NULL,
    "lockedUntil" TIMESTAMP(3) NOT NULL,
    "owner" TEXT NOT NULL,

    CONSTRAINT "scheduler_locks_pkey" PRIMARY KEY ("name")
);

-- Backfill: events that existed before this migration were already handled
-- by the old timer. Mark them escalated so the new sweeper never re-sends
-- SMS for historical emergencies.
UPDATE "emergency_events" SET "escalatedAt" = "createdAt" WHERE "escalatedAt" IS NULL;
