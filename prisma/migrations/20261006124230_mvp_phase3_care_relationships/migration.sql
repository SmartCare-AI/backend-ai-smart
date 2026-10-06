-- CreateEnum
CREATE TYPE "CareRelationshipOrigin" AS ENUM ('APPOINTMENT');

-- CreateEnum
CREATE TYPE "CareRelationshipStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED');

-- CreateTable
CREATE TABLE "care_relationships" (
    "id" SERIAL NOT NULL,
    "patientId" INTEGER NOT NULL,
    "doctorId" INTEGER NOT NULL,
    "origin" "CareRelationshipOrigin" NOT NULL DEFAULT 'APPOINTMENT',
    "status" "CareRelationshipStatus" NOT NULL DEFAULT 'ACTIVE',
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "care_relationships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "care_relationships_doctorId_status_idx" ON "care_relationships"("doctorId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "care_relationships_patientId_doctorId_key" ON "care_relationships"("patientId", "doctorId");

-- AddForeignKey
ALTER TABLE "care_relationships" ADD CONSTRAINT "care_relationships_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patient_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care_relationships" ADD CONSTRAINT "care_relationships_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "doctor_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill from existing appointments: every patient/doctor pair with a
-- CONFIRMED or COMPLETED appointment gets a relationship lasting 12 months
-- after their latest such appointment (same rule as the Phase 0 gate).
INSERT INTO "care_relationships" ("patientId", "doctorId", "origin", "status", "startsAt", "expiresAt", "updatedAt")
SELECT
  a."patientId",
  a."doctorId",
  'APPOINTMENT',
  CASE WHEN MAX(a."endTime") + INTERVAL '12 months' > NOW()
       THEN 'ACTIVE'::"CareRelationshipStatus"
       ELSE 'EXPIRED'::"CareRelationshipStatus" END,
  MIN(a."startTime"),
  MAX(a."endTime") + INTERVAL '12 months',
  NOW()
FROM "appointments" a
WHERE a."status" IN ('CONFIRMED', 'COMPLETED')
GROUP BY a."patientId", a."doctorId";
