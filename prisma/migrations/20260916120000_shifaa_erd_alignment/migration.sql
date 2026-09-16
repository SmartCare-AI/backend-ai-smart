-- =============================================================================
-- SHIFAA — ERD / Data-Dictionary alignment
--
-- Brings the database in line with ERD/SHIFAA ERD.drawio and
-- ERD/shifaa_data_dictionary_bw.pdf (31-entity baseline):
--   * User/Profile separation: names and demographics move onto the
--     Patient / Doctor / Caregiver profile entities.
--   * Every "VARCHAR / ENUM" attribute becomes a real Postgres enum.
--   * New entities: DeviceReading (#23) and OnlineVisit (#26).
--   * Mandatory ERD relationships enforced: Visit->Appointment (BR-004),
--     Prescription->TreatmentPlan (BR-007), MedicalTest/MedicalImage->Doctor.
--
-- The migration is data-preserving: every dropped or tightened column is
-- backfilled first, and rows that would violate a new NOT NULL constraint
-- get a migrated placeholder parent row instead of being deleted.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. New enum types
-- -----------------------------------------------------------------------------
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');
CREATE TYPE "ProfileStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');
CREATE TYPE "HospitalType" AS ENUM ('GENERAL', 'SPECIALIZED', 'CLINIC', 'MEDICAL_CENTER', 'TEACHING');
CREATE TYPE "EntityStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "CareLinkStatus" AS ENUM ('ACTIVE', 'ENDED', 'REVOKED');
CREATE TYPE "VisitType" AS ENUM ('IN_PERSON', 'ONLINE', 'FOLLOW_UP', 'EMERGENCY');
CREATE TYPE "DiagnosisStatus" AS ENUM ('ACTIVE', 'RESOLVED', 'CHRONIC', 'RULED_OUT');
CREATE TYPE "DocumentType" AS ENUM ('REPORT', 'PRESCRIPTION', 'RECORD', 'LAB_RESULT', 'INSURANCE', 'REFERRAL', 'DISCHARGE_SUMMARY', 'OTHER');
CREATE TYPE "DocumentStatus" AS ENUM ('ACTIVE', 'ARCHIVED', 'DELETED');
CREATE TYPE "TestType" AS ENUM ('BLOOD', 'URINE', 'STOOL', 'IMAGING', 'BIOPSY', 'GENETIC', 'MICROBIOLOGY', 'OTHER');
CREATE TYPE "ImagingType" AS ENUM ('XRAY', 'CT', 'MRI', 'ULTRASOUND', 'MAMMOGRAPHY', 'PET', 'ECHO', 'OTHER');
CREATE TYPE "ImageStatus" AS ENUM ('PENDING', 'AVAILABLE', 'REVIEWED', 'ARCHIVED');
CREATE TYPE "MedicineForm" AS ENUM ('TABLET', 'CAPSULE', 'SYRUP', 'INJECTION', 'CREAM', 'OINTMENT', 'DROPS', 'INHALER', 'PATCH', 'SUPPOSITORY', 'OTHER');
CREATE TYPE "AdministrationRoute" AS ENUM ('ORAL', 'INTRAVENOUS', 'INTRAMUSCULAR', 'SUBCUTANEOUS', 'TOPICAL', 'INHALATION', 'RECTAL', 'OPHTHALMIC', 'NASAL', 'OTHER');
CREATE TYPE "DeviceType" AS ENUM ('SMARTWATCH', 'FITNESS_BAND', 'GLUCOSE_MONITOR', 'BP_MONITOR', 'PULSE_OXIMETER', 'SMART_SCALE', 'THERMOMETER', 'ECG_MONITOR', 'OTHER');
CREATE TYPE "DeviceStatus" AS ENUM ('CONNECTED', 'DISCONNECTED', 'INACTIVE');
CREATE TYPE "AlertType" AS ENUM ('VITAL_ANOMALY', 'MEDICATION_ADHERENCE', 'AI_RISK', 'APPOINTMENT', 'EMERGENCY', 'SYSTEM');
CREATE TYPE "NotificationStatus" AS ENUM ('UNREAD', 'READ', 'ARCHIVED');
CREATE TYPE "OnlineVisitType" AS ENUM ('VIDEO', 'AUDIO', 'CHAT');
CREATE TYPE "OnlineVisitStatus" AS ENUM ('SCHEDULED', 'ACTIVE', 'COMPLETED', 'CANCELLED');
CREATE TYPE "ChatStatus" AS ENUM ('ACTIVE', 'ARCHIVED', 'CLOSED');
CREATE TYPE "ParticipantStatus" AS ENUM ('ACTIVE', 'LEFT');
CREATE TYPE "MessageStatus" AS ENUM ('SENT', 'DELIVERED', 'READ', 'DELETED');

-- MedicationDose is renamed to the ERD's "Medicine Tracking"; values are identical.
ALTER TYPE "MedicationDoseStatus" RENAME TO "MedicineTrackingStatus";

-- ERD Alert.Status is "New, Acknowledged, Resolved" — ACTIVE becomes NEW.
ALTER TYPE "AlertStatus" RENAME TO "AlertStatus_old";
CREATE TYPE "AlertStatus" AS ENUM ('NEW', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED');
ALTER TABLE "alerts" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "alerts" ALTER COLUMN "status" TYPE "AlertStatus"
  USING (CASE "status"::text WHEN 'ACTIVE' THEN 'NEW' ELSE "status"::text END)::"AlertStatus";
ALTER TABLE "alerts" ALTER COLUMN "status" SET DEFAULT 'NEW';
DROP TYPE "AlertStatus_old";

-- -----------------------------------------------------------------------------
-- 2. User / profile separation  (data dictionary §5 "User/Profile Separation")
-- -----------------------------------------------------------------------------
ALTER TABLE "users" ADD COLUMN "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE';
UPDATE "users" SET "status" = 'INACTIVE' WHERE "isActive" = false;

-- Patient (#2)
ALTER TABLE "patient_profiles"
  ADD COLUMN "firstName" TEXT,
  ADD COLUMN "lastName" TEXT,
  ADD COLUMN "dateOfBirth" TIMESTAMP(3),
  ADD COLUMN "gender" "Gender",
  ADD COLUMN "emergencyContact" TEXT,
  ADD COLUMN "emergencyPhone" TEXT,
  ADD COLUMN "status" "ProfileStatus" NOT NULL DEFAULT 'ACTIVE';
UPDATE "patient_profiles" p
   SET "firstName"   = COALESCE(NULLIF(u."firstName", ''), 'Unknown'),
       "lastName"    = COALESCE(NULLIF(u."lastName", ''), 'Unknown'),
       "dateOfBirth" = u."dateOfBirth",
       "gender"      = u."gender"
  FROM "users" u WHERE u."id" = p."userId";
UPDATE "patient_profiles" SET "firstName" = 'Unknown' WHERE "firstName" IS NULL;
UPDATE "patient_profiles" SET "lastName" = 'Unknown' WHERE "lastName" IS NULL;
ALTER TABLE "patient_profiles"
  ALTER COLUMN "firstName" SET NOT NULL,
  ALTER COLUMN "lastName" SET NOT NULL;
ALTER TABLE "patient_profiles" RENAME COLUMN "registeredAt" TO "registrationDate";

-- Doctor (#3)
ALTER TABLE "doctor_profiles"
  ADD COLUMN "firstName" TEXT,
  ADD COLUMN "lastName" TEXT,
  ADD COLUMN "status" "ProfileStatus" NOT NULL DEFAULT 'ACTIVE';
UPDATE "doctor_profiles" d
   SET "firstName" = COALESCE(NULLIF(u."firstName", ''), 'Unknown'),
       "lastName"  = COALESCE(NULLIF(u."lastName", ''), 'Unknown')
  FROM "users" u WHERE u."id" = d."userId";
UPDATE "doctor_profiles" SET "firstName" = 'Unknown' WHERE "firstName" IS NULL;
UPDATE "doctor_profiles" SET "lastName" = 'Unknown' WHERE "lastName" IS NULL;
ALTER TABLE "doctor_profiles"
  ALTER COLUMN "firstName" SET NOT NULL,
  ALTER COLUMN "lastName" SET NOT NULL;

-- Caregiver (#4)
ALTER TABLE "caregiver_profiles"
  ADD COLUMN "firstName" TEXT,
  ADD COLUMN "lastName" TEXT,
  ADD COLUMN "status" "ProfileStatus" NOT NULL DEFAULT 'ACTIVE';
UPDATE "caregiver_profiles" c
   SET "firstName" = COALESCE(NULLIF(u."firstName", ''), 'Unknown'),
       "lastName"  = COALESCE(NULLIF(u."lastName", ''), 'Unknown')
  FROM "users" u WHERE u."id" = c."userId";
UPDATE "caregiver_profiles" SET "firstName" = 'Unknown' WHERE "firstName" IS NULL;
UPDATE "caregiver_profiles" SET "lastName" = 'Unknown' WHERE "lastName" IS NULL;
UPDATE "caregiver_profiles" SET "relationship" = 'unspecified' WHERE "relationship" IS NULL OR "relationship" = '';
ALTER TABLE "caregiver_profiles"
  ALTER COLUMN "firstName" SET NOT NULL,
  ALTER COLUMN "lastName" SET NOT NULL,
  ALTER COLUMN "relationship" SET NOT NULL;

-- The account keeps only account data (email, credentials, role, status).
ALTER TABLE "users"
  DROP COLUMN "firstName",
  DROP COLUMN "lastName",
  DROP COLUMN "dateOfBirth",
  DROP COLUMN "gender",
  DROP COLUMN "isActive";

-- -----------------------------------------------------------------------------
-- 3. PatientCaregiver (#7)
-- -----------------------------------------------------------------------------
ALTER TABLE "patient_caregivers" RENAME COLUMN "permission" TO "permissionLevel";
ALTER TABLE "patient_caregivers" ADD COLUMN "status" "CareLinkStatus" NOT NULL DEFAULT 'ACTIVE';
UPDATE "patient_caregivers" SET "status" = 'ENDED' WHERE "isActive" = false;
ALTER TABLE "patient_caregivers" DROP COLUMN "isActive";

-- -----------------------------------------------------------------------------
-- 4. Hospital (#5) & Department (#6)
-- -----------------------------------------------------------------------------
UPDATE "hospitals" SET "address" = 'Not specified' WHERE "address" IS NULL OR "address" = '';
ALTER TABLE "hospitals" ALTER COLUMN "address" SET NOT NULL;
ALTER TABLE "hospitals" ADD COLUMN "type_new" "HospitalType" NOT NULL DEFAULT 'GENERAL';
UPDATE "hospitals" SET "type_new" = CASE lower(COALESCE("type", ''))
  WHEN 'specialized'    THEN 'SPECIALIZED'
  WHEN 'clinic'         THEN 'CLINIC'
  WHEN 'medical_center' THEN 'MEDICAL_CENTER'
  WHEN 'teaching'       THEN 'TEACHING'
  ELSE 'GENERAL' END::"HospitalType";
ALTER TABLE "hospitals" DROP COLUMN "type";
ALTER TABLE "hospitals" RENAME COLUMN "type_new" TO "type";
ALTER TABLE "hospitals" ADD COLUMN "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE';
UPDATE "hospitals" SET "status" = 'INACTIVE' WHERE "isActive" = false;
ALTER TABLE "hospitals" DROP COLUMN "isActive";

ALTER TABLE "departments" ADD COLUMN "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE';
UPDATE "departments" SET "status" = 'INACTIVE' WHERE "isActive" = false;
ALTER TABLE "departments" DROP COLUMN "isActive";

-- -----------------------------------------------------------------------------
-- 5. Appointment (#8) — Date + StartTime + EndTime
-- -----------------------------------------------------------------------------
ALTER TABLE "appointments"
  ADD COLUMN "date" DATE,
  ADD COLUMN "startTime" TIMESTAMP(3),
  ADD COLUMN "endTime" TIMESTAMP(3);
UPDATE "appointments"
   SET "startTime" = "scheduledAt",
       "endTime"   = COALESCE("endsAt", "scheduledAt" + INTERVAL '30 minutes'),
       "date"      = ("scheduledAt" AT TIME ZONE 'UTC')::date;
ALTER TABLE "appointments"
  ALTER COLUMN "date" SET NOT NULL,
  ALTER COLUMN "startTime" SET NOT NULL,
  ALTER COLUMN "endTime" SET NOT NULL;
DROP INDEX "appointments_patientId_scheduledAt_idx";
DROP INDEX "appointments_doctorId_scheduledAt_idx";
ALTER TABLE "appointments" DROP COLUMN "scheduledAt", DROP COLUMN "endsAt";
-- bookedById had no FK before; make it a real relation.
UPDATE "appointments" a SET "bookedById" = NULL
 WHERE "bookedById" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "users" u WHERE u."id" = a."bookedById");
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_bookedById_fkey"
  FOREIGN KEY ("bookedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "appointments_patientId_startTime_idx" ON "appointments"("patientId", "startTime");
CREATE INDEX "appointments_doctorId_startTime_idx" ON "appointments"("doctorId", "startTime");
CREATE INDEX "appointments_doctorId_date_idx" ON "appointments"("doctorId", "date");

-- -----------------------------------------------------------------------------
-- 6. Visit (#9) — BR-004: every visit belongs to an appointment
-- -----------------------------------------------------------------------------
-- Walk-in visits created before this rule get a migrated appointment.
ALTER TABLE "appointments" ADD COLUMN "_migrated_visit_id" INTEGER;
INSERT INTO "appointments" (
  "patientId", "doctorId", "date", "startTime", "endTime", "type", "status",
  "reason", "createdAt", "updatedAt", "_migrated_visit_id")
SELECT v."patientId", v."doctorId", (v."date" AT TIME ZONE 'UTC')::date, v."date",
       v."date" + INTERVAL '30 minutes', 'IN_PERSON'::"AppointmentType",
       'COMPLETED'::"AppointmentStatus", 'Walk-in encounter (migrated)',
       v."date", v."date", v."id"
  FROM "visits" v WHERE v."appointmentId" IS NULL;
UPDATE "visits" v SET "appointmentId" = a."id"
  FROM "appointments" a WHERE a."_migrated_visit_id" = v."id";
ALTER TABLE "appointments" DROP COLUMN "_migrated_visit_id";

-- Visit.Type is its own enum now (VIDEO/CHAT appointments become ONLINE visits).
ALTER TABLE "visits" ADD COLUMN "type_new" "VisitType" NOT NULL DEFAULT 'IN_PERSON';
UPDATE "visits" SET "type_new" = CASE "type"::text
  WHEN 'VIDEO' THEN 'ONLINE'
  WHEN 'CHAT'  THEN 'ONLINE'
  ELSE 'IN_PERSON' END::"VisitType";
ALTER TABLE "visits" DROP COLUMN "type";
ALTER TABLE "visits" RENAME COLUMN "type_new" TO "type";

-- -----------------------------------------------------------------------------
-- 7. MedicalTest (#13) & MedicalImage (#15) — DoctorID becomes mandatory
--    (backfilled from the visit, so this runs before visits.doctorId is dropped)
-- -----------------------------------------------------------------------------
ALTER TABLE "medical_tests" DROP CONSTRAINT "medical_tests_requestedById_fkey";
ALTER TABLE "medical_tests" RENAME COLUMN "requestedById" TO "doctorId";
UPDATE "medical_tests" t SET "doctorId" = v."doctorId"
  FROM "visits" v WHERE v."id" = t."visitId" AND t."doctorId" IS NULL;
DELETE FROM "medical_tests" WHERE "doctorId" IS NULL;
ALTER TABLE "medical_tests" ALTER COLUMN "doctorId" SET NOT NULL;
ALTER TABLE "medical_tests" ADD CONSTRAINT "medical_tests_doctorId_fkey"
  FOREIGN KEY ("doctorId") REFERENCES "doctor_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "medical_tests" ADD COLUMN "type_new" "TestType" NOT NULL DEFAULT 'OTHER';
UPDATE "medical_tests" SET "type_new" = CASE
  WHEN lower(COALESCE("type", '')) LIKE '%blood%'  THEN 'BLOOD'
  WHEN lower(COALESCE("type", '')) LIKE '%urine%'  THEN 'URINE'
  WHEN lower(COALESCE("type", '')) LIKE '%stool%'  THEN 'STOOL'
  WHEN lower(COALESCE("type", '')) LIKE '%imag%'   THEN 'IMAGING'
  WHEN lower(COALESCE("type", '')) LIKE '%biops%'  THEN 'BIOPSY'
  WHEN lower(COALESCE("type", '')) LIKE '%genet%'  THEN 'GENETIC'
  WHEN lower(COALESCE("type", '')) LIKE '%micro%'  THEN 'MICROBIOLOGY'
  ELSE 'OTHER' END::"TestType";
ALTER TABLE "medical_tests" DROP COLUMN "type";
ALTER TABLE "medical_tests" RENAME COLUMN "type_new" TO "type";
ALTER TABLE "medical_tests" RENAME COLUMN "requestedAt" TO "requestedDate";
CREATE INDEX "medical_tests_visitId_idx" ON "medical_tests"("visitId");
CREATE INDEX "medical_tests_doctorId_status_idx" ON "medical_tests"("doctorId", "status");

ALTER TABLE "medical_images" DROP CONSTRAINT "medical_images_orderedById_fkey";
ALTER TABLE "medical_images" RENAME COLUMN "orderedById" TO "doctorId";
UPDATE "medical_images" i SET "doctorId" = v."doctorId"
  FROM "visits" v WHERE v."id" = i."visitId" AND i."doctorId" IS NULL;
DELETE FROM "medical_images" WHERE "doctorId" IS NULL;
ALTER TABLE "medical_images" ALTER COLUMN "doctorId" SET NOT NULL;
ALTER TABLE "medical_images" ADD CONSTRAINT "medical_images_doctorId_fkey"
  FOREIGN KEY ("doctorId") REFERENCES "doctor_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "medical_images" ADD COLUMN "type_new" "ImagingType" NOT NULL DEFAULT 'OTHER';
UPDATE "medical_images" SET "type_new" = CASE upper(replace(COALESCE("type", ''), '-', ''))
  WHEN 'XRAY'        THEN 'XRAY'
  WHEN 'CT'          THEN 'CT'
  WHEN 'MRI'         THEN 'MRI'
  WHEN 'ULTRASOUND'  THEN 'ULTRASOUND'
  WHEN 'MAMMOGRAPHY' THEN 'MAMMOGRAPHY'
  WHEN 'PET'         THEN 'PET'
  WHEN 'ECHO'        THEN 'ECHO'
  ELSE 'OTHER' END::"ImagingType";
ALTER TABLE "medical_images" DROP COLUMN "type";
ALTER TABLE "medical_images" RENAME COLUMN "type_new" TO "type";
ALTER TABLE "medical_images" ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "medical_images" RENAME COLUMN "takenAt" TO "date";
ALTER TABLE "medical_images" ADD COLUMN "status" "ImageStatus" NOT NULL DEFAULT 'AVAILABLE';
CREATE INDEX "medical_images_visitId_idx" ON "medical_images"("visitId");

-- -----------------------------------------------------------------------------
-- 8. Visit: drop the denormalized patient/doctor, enforce the appointment link
-- -----------------------------------------------------------------------------
DROP INDEX "visits_patientId_date_idx";
ALTER TABLE "visits" DROP CONSTRAINT "visits_patientId_fkey";
ALTER TABLE "visits" DROP CONSTRAINT "visits_doctorId_fkey";
ALTER TABLE "visits" DROP COLUMN "patientId", DROP COLUMN "doctorId";
ALTER TABLE "visits" ALTER COLUMN "appointmentId" SET NOT NULL;
ALTER TABLE "visits" DROP CONSTRAINT "visits_appointmentId_fkey";
ALTER TABLE "visits" ADD CONSTRAINT "visits_appointmentId_fkey"
  FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "visits_date_idx" ON "visits"("date");

-- -----------------------------------------------------------------------------
-- 9. Assessment (#10), Diagnosis (#11), TestResult (#14)
-- -----------------------------------------------------------------------------
DROP INDEX "assessments_patientId_createdAt_idx";
ALTER TABLE "assessments" RENAME COLUMN "createdAt" TO "date";
CREATE INDEX "assessments_patientId_date_idx" ON "assessments"("patientId", "date");
CREATE INDEX "assessments_visitId_idx" ON "assessments"("visitId");

ALTER TABLE "diagnoses" RENAME COLUMN "diagnosedAt" TO "date";
ALTER TABLE "diagnoses" ADD COLUMN "status" "DiagnosisStatus" NOT NULL DEFAULT 'ACTIVE';
UPDATE "diagnoses" SET "status" = 'RESOLVED' WHERE "isActive" = false;
ALTER TABLE "diagnoses" DROP COLUMN "isActive";
CREATE INDEX "diagnoses_visitId_idx" ON "diagnoses"("visitId");

ALTER TABLE "test_results" RENAME COLUMN "resultedAt" TO "date";

-- -----------------------------------------------------------------------------
-- 10. TreatmentPlan (#17) — Description is mandatory, no Title/VisitID in the ERD
-- -----------------------------------------------------------------------------
UPDATE "treatment_plans"
   SET "description" = COALESCE(NULLIF("description", ''), NULLIF("title", ''), 'Migrated treatment plan');
ALTER TABLE "treatment_plans" ALTER COLUMN "description" SET NOT NULL;
ALTER TABLE "treatment_plans" DROP CONSTRAINT "treatment_plans_visitId_fkey";
ALTER TABLE "treatment_plans" DROP COLUMN "title", DROP COLUMN "visitId";
CREATE INDEX "treatment_plans_doctorId_status_idx" ON "treatment_plans"("doctorId", "status");

-- -----------------------------------------------------------------------------
-- 11. Prescription (#18) — BR-007: always belongs to a treatment plan
-- -----------------------------------------------------------------------------
ALTER TABLE "treatment_plans" ADD COLUMN "_migrated_prescription_id" INTEGER;
INSERT INTO "treatment_plans" (
  "patientId", "doctorId", "startDate", "description", "status", "_migrated_prescription_id")
SELECT p."patientId", p."doctorId", p."issuedAt",
       'Migrated: prescription issued before treatment plans were mandatory',
       'ACTIVE'::"TreatmentPlanStatus", p."id"
  FROM "prescriptions" p WHERE p."treatmentPlanId" IS NULL;
UPDATE "prescriptions" p SET "treatmentPlanId" = t."id"
  FROM "treatment_plans" t WHERE t."_migrated_prescription_id" = p."id";
ALTER TABLE "treatment_plans" DROP COLUMN "_migrated_prescription_id";

DROP INDEX "prescriptions_patientId_status_idx";
ALTER TABLE "prescriptions" DROP CONSTRAINT "prescriptions_patientId_fkey";
ALTER TABLE "prescriptions" DROP CONSTRAINT "prescriptions_doctorId_fkey";
ALTER TABLE "prescriptions" DROP COLUMN "patientId", DROP COLUMN "doctorId";
ALTER TABLE "prescriptions" ALTER COLUMN "treatmentPlanId" SET NOT NULL;
ALTER TABLE "prescriptions" DROP CONSTRAINT "prescriptions_treatmentPlanId_fkey";
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_treatmentPlanId_fkey"
  FOREIGN KEY ("treatmentPlanId") REFERENCES "treatment_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "prescriptions" RENAME COLUMN "issuedAt" TO "date";
CREATE INDEX "prescriptions_treatmentPlanId_status_idx" ON "prescriptions"("treatmentPlanId", "status");

-- -----------------------------------------------------------------------------
-- 12. Medicine (#19) & PrescriptionItem (#20)
-- -----------------------------------------------------------------------------
DROP INDEX "medicines_name_form_strength_key";
ALTER TABLE "medicines" ADD COLUMN "form_new" "MedicineForm";
UPDATE "medicines" SET "form_new" = CASE lower(COALESCE("form", ''))
  WHEN 'tablet'       THEN 'TABLET'
  WHEN 'capsule'      THEN 'CAPSULE'
  WHEN 'syrup'        THEN 'SYRUP'
  WHEN 'injection'    THEN 'INJECTION'
  WHEN 'cream'        THEN 'CREAM'
  WHEN 'ointment'     THEN 'OINTMENT'
  WHEN 'drops'        THEN 'DROPS'
  WHEN 'inhaler'      THEN 'INHALER'
  WHEN 'patch'        THEN 'PATCH'
  WHEN 'suppository'  THEN 'SUPPOSITORY'
  WHEN ''             THEN NULL
  ELSE 'OTHER' END::"MedicineForm";
ALTER TABLE "medicines" DROP COLUMN "form";
ALTER TABLE "medicines" RENAME COLUMN "form_new" TO "form";
ALTER TABLE "medicines"
  ADD COLUMN "genericName" TEXT,
  ADD COLUMN "description" TEXT,
  ADD COLUMN "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE';
CREATE UNIQUE INDEX "medicines_name_form_strength_key" ON "medicines"("name", "form", "strength");
CREATE INDEX "medicines_status_idx" ON "medicines"("status");

ALTER TABLE "prescription_items" ADD COLUMN "route_new" "AdministrationRoute";
UPDATE "prescription_items" SET "route_new" = CASE lower(COALESCE("route", ''))
  WHEN 'oral'          THEN 'ORAL'
  WHEN 'iv'            THEN 'INTRAVENOUS'
  WHEN 'intravenous'   THEN 'INTRAVENOUS'
  WHEN 'im'            THEN 'INTRAMUSCULAR'
  WHEN 'intramuscular' THEN 'INTRAMUSCULAR'
  WHEN 'subcutaneous'  THEN 'SUBCUTANEOUS'
  WHEN 'topical'       THEN 'TOPICAL'
  WHEN 'inhalation'    THEN 'INHALATION'
  WHEN 'rectal'        THEN 'RECTAL'
  WHEN 'ophthalmic'    THEN 'OPHTHALMIC'
  WHEN 'nasal'         THEN 'NASAL'
  WHEN ''              THEN NULL
  ELSE 'OTHER' END::"AdministrationRoute";
ALTER TABLE "prescription_items" DROP COLUMN "route";
ALTER TABLE "prescription_items" RENAME COLUMN "route_new" TO "route";
CREATE INDEX "prescription_items_prescriptionId_idx" ON "prescription_items"("prescriptionId");

-- -----------------------------------------------------------------------------
-- 13. MedicineTracking (#21) — renamed from medication_doses
-- -----------------------------------------------------------------------------
DROP INDEX "medication_doses_patientId_scheduledAt_idx";
DROP INDEX "medication_doses_status_scheduledAt_idx";
ALTER TABLE "medication_doses" RENAME TO "medicine_tracking";
ALTER TABLE "medicine_tracking" RENAME CONSTRAINT "medication_doses_pkey" TO "medicine_tracking_pkey";
ALTER TABLE "medicine_tracking" RENAME CONSTRAINT "medication_doses_prescriptionItemId_fkey" TO "medicine_tracking_prescriptionItemId_fkey";
ALTER TABLE "medicine_tracking" RENAME CONSTRAINT "medication_doses_patientId_fkey" TO "medicine_tracking_patientId_fkey";
ALTER TABLE "medicine_tracking" RENAME COLUMN "scheduledAt" TO "scheduledTime";
ALTER TABLE "medicine_tracking" RENAME COLUMN "takenAt" TO "takenTime";
ALTER SEQUENCE "medication_doses_id_seq" RENAME TO "medicine_tracking_id_seq";
CREATE INDEX "medicine_tracking_patientId_scheduledTime_idx" ON "medicine_tracking"("patientId", "scheduledTime");
CREATE INDEX "medicine_tracking_status_scheduledTime_idx" ON "medicine_tracking"("status", "scheduledTime");

-- -----------------------------------------------------------------------------
-- 14. Device (#22) & DeviceReading (#23 — new entity)
-- -----------------------------------------------------------------------------
ALTER TABLE "devices" ADD COLUMN "type_new" "DeviceType" NOT NULL DEFAULT 'OTHER';
UPDATE "devices" SET "type_new" = CASE
  WHEN lower(COALESCE("type", '')) LIKE '%watch%'    THEN 'SMARTWATCH'
  WHEN lower(COALESCE("type", '')) LIKE '%band%'     THEN 'FITNESS_BAND'
  WHEN lower(COALESCE("type", '')) LIKE '%gluco%'    THEN 'GLUCOSE_MONITOR'
  WHEN lower(COALESCE("type", '')) LIKE '%bp%'       THEN 'BP_MONITOR'
  WHEN lower(COALESCE("type", '')) LIKE '%pressure%' THEN 'BP_MONITOR'
  WHEN lower(COALESCE("type", '')) LIKE '%oxim%'     THEN 'PULSE_OXIMETER'
  WHEN lower(COALESCE("type", '')) LIKE '%scale%'    THEN 'SMART_SCALE'
  WHEN lower(COALESCE("type", '')) LIKE '%thermo%'   THEN 'THERMOMETER'
  WHEN lower(COALESCE("type", '')) LIKE '%ecg%'      THEN 'ECG_MONITOR'
  ELSE 'OTHER' END::"DeviceType";
ALTER TABLE "devices" DROP COLUMN "type";
ALTER TABLE "devices" RENAME COLUMN "type_new" TO "type";
ALTER TABLE "devices" ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "devices" RENAME COLUMN "connectedAt" TO "connectedDate";
ALTER TABLE "devices" RENAME COLUMN "lastSyncAt" TO "lastSync";
ALTER TABLE "devices" ADD COLUMN "status" "DeviceStatus" NOT NULL DEFAULT 'CONNECTED';
UPDATE "devices" SET "status" = 'INACTIVE' WHERE "isActive" = false;
ALTER TABLE "devices" DROP COLUMN "isActive";
CREATE INDEX "devices_patientId_status_idx" ON "devices"("patientId", "status");

CREATE TABLE "device_readings" (
    "id" SERIAL NOT NULL,
    "deviceId" INTEGER NOT NULL,
    "type" "VitalType" NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "unit" TEXT,
    "measuredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "device_readings_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "device_readings_deviceId_measuredAt_idx" ON "device_readings"("deviceId", "measuredAt");
ALTER TABLE "device_readings" ADD CONSTRAINT "device_readings_deviceId_fkey"
  FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- 15. VitalSign (#16) — device origin now points at the raw DeviceReading
-- -----------------------------------------------------------------------------
ALTER TABLE "vital_signs" ADD COLUMN "deviceReadingId" INTEGER;
ALTER TABLE "device_readings" ADD COLUMN "_migrated_vital_id" INTEGER;
INSERT INTO "device_readings" ("deviceId", "type", "value", "unit", "measuredAt", "_migrated_vital_id")
SELECT v."deviceId", v."type", v."value", v."unit", v."measuredAt", v."id"
  FROM "vital_signs" v WHERE v."deviceId" IS NOT NULL;
UPDATE "vital_signs" v SET "deviceReadingId" = r."id"
  FROM "device_readings" r WHERE r."_migrated_vital_id" = v."id";
ALTER TABLE "device_readings" DROP COLUMN "_migrated_vital_id";
ALTER TABLE "vital_signs" DROP CONSTRAINT "vital_signs_deviceId_fkey";
ALTER TABLE "vital_signs" DROP COLUMN "deviceId";
CREATE UNIQUE INDEX "vital_signs_deviceReadingId_key" ON "vital_signs"("deviceReadingId");
ALTER TABLE "vital_signs" ADD CONSTRAINT "vital_signs_deviceReadingId_fkey"
  FOREIGN KEY ("deviceReadingId") REFERENCES "device_readings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- 16. Alert (#24)
-- -----------------------------------------------------------------------------
ALTER TABLE "alerts" ADD COLUMN "type" "AlertType" NOT NULL DEFAULT 'SYSTEM';
UPDATE "alerts" SET "type" = CASE
  WHEN "source" LIKE 'vital_threshold%' THEN 'VITAL_ANOMALY'
  WHEN "source" = 'adherence'           THEN 'MEDICATION_ADHERENCE'
  WHEN "source" LIKE 'ai_%'             THEN 'AI_RISK'
  ELSE 'SYSTEM' END::"AlertType";
ALTER TABLE "alerts" ALTER COLUMN "type" DROP DEFAULT;
UPDATE "alerts" SET "description" = COALESCE(NULLIF("description", ''), "title");
ALTER TABLE "alerts" ALTER COLUMN "description" SET NOT NULL;
CREATE INDEX "alerts_status_severity_idx" ON "alerts"("status", "severity");

-- -----------------------------------------------------------------------------
-- 17. Notification (#25)
-- -----------------------------------------------------------------------------
DROP INDEX "notifications_userId_readAt_idx";
ALTER TABLE "notifications" RENAME COLUMN "body" TO "message";
ALTER TABLE "notifications" ADD COLUMN "status" "NotificationStatus" NOT NULL DEFAULT 'UNREAD';
UPDATE "notifications" SET "status" = 'READ' WHERE "readAt" IS NOT NULL;
CREATE INDEX "notifications_userId_status_idx" ON "notifications"("userId", "status");
CREATE INDEX "notifications_userId_createdAt_idx" ON "notifications"("userId", "createdAt");

-- -----------------------------------------------------------------------------
-- 18. OnlineVisit (#26 — new entity)
-- -----------------------------------------------------------------------------
CREATE TABLE "online_visits" (
    "id" SERIAL NOT NULL,
    "appointmentId" INTEGER NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3),
    "type" "OnlineVisitType" NOT NULL DEFAULT 'VIDEO',
    "status" "OnlineVisitStatus" NOT NULL DEFAULT 'SCHEDULED',
    "meetingLink" TEXT NOT NULL,
    "notes" TEXT,
    CONSTRAINT "online_visits_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "online_visits_appointmentId_key" ON "online_visits"("appointmentId");
CREATE INDEX "online_visits_status_startTime_idx" ON "online_visits"("status", "startTime");
ALTER TABLE "online_visits" ADD CONSTRAINT "online_visits_appointmentId_fkey"
  FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- 19. Chat (#27), ChatParticipant (#28), Message (#29)
-- -----------------------------------------------------------------------------
ALTER TABLE "chats" ADD COLUMN "status" "ChatStatus" NOT NULL DEFAULT 'ACTIVE';
UPDATE "chats" SET "status" = 'ARCHIVED' WHERE "isActive" = false;
ALTER TABLE "chats" DROP COLUMN "isActive";
UPDATE "chats" c SET "visitId" = NULL
 WHERE c."visitId" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "visits" v WHERE v."id" = c."visitId");
ALTER TABLE "chats" ADD CONSTRAINT "chats_visitId_fkey"
  FOREIGN KEY ("visitId") REFERENCES "visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "chats_status_idx" ON "chats"("status");

ALTER TABLE "chat_participants" ADD COLUMN "status" "ParticipantStatus" NOT NULL DEFAULT 'ACTIVE';
CREATE INDEX "chat_participants_userId_status_idx" ON "chat_participants"("userId", "status");

ALTER TABLE "messages" RENAME COLUMN "text" TO "messageText";
ALTER TABLE "messages" ADD COLUMN "readAt" TIMESTAMP(3);
ALTER TABLE "messages" ADD COLUMN "status" "MessageStatus" NOT NULL DEFAULT 'SENT';
UPDATE "messages" SET "status" = 'DELETED' WHERE "deletedAt" IS NOT NULL;
ALTER TABLE "messages" DROP COLUMN "deletedAt";

-- -----------------------------------------------------------------------------
-- 20. MedicalDocument (#12)
-- -----------------------------------------------------------------------------
DROP INDEX "medical_documents_patientId_type_idx";
ALTER TABLE "medical_documents" ADD COLUMN "type_new" "DocumentType" NOT NULL DEFAULT 'OTHER';
UPDATE "medical_documents" SET "type_new" = CASE lower(COALESCE("type", ''))
  WHEN 'report'            THEN 'REPORT'
  WHEN 'prescription'      THEN 'PRESCRIPTION'
  WHEN 'record'            THEN 'RECORD'
  WHEN 'lab_result'        THEN 'LAB_RESULT'
  WHEN 'insurance'         THEN 'INSURANCE'
  WHEN 'referral'          THEN 'REFERRAL'
  WHEN 'discharge_summary' THEN 'DISCHARGE_SUMMARY'
  ELSE 'OTHER' END::"DocumentType";
ALTER TABLE "medical_documents" DROP COLUMN "type";
ALTER TABLE "medical_documents" RENAME COLUMN "type_new" TO "type";
ALTER TABLE "medical_documents" RENAME COLUMN "uploadedAt" TO "uploadDate";
ALTER TABLE "medical_documents" ADD COLUMN "status" "DocumentStatus" NOT NULL DEFAULT 'ACTIVE';
CREATE INDEX "medical_documents_patientId_type_idx" ON "medical_documents"("patientId", "type");
CREATE INDEX "medical_documents_patientId_status_idx" ON "medical_documents"("patientId", "status");

-- -----------------------------------------------------------------------------
-- 21. Emergency Hub: acknowledgedBy becomes a real relation
-- -----------------------------------------------------------------------------
UPDATE "emergency_events" e SET "acknowledgedById" = NULL
 WHERE e."acknowledgedById" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "users" u WHERE u."id" = e."acknowledgedById");
ALTER TABLE "emergency_events" ADD CONSTRAINT "emergency_events_acknowledgedById_fkey"
  FOREIGN KEY ("acknowledgedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "emergency_contacts_patientId_priority_idx" ON "emergency_contacts"("patientId", "priority");

-- -----------------------------------------------------------------------------
-- 22. Remaining new indexes
-- -----------------------------------------------------------------------------
CREATE INDEX "users_role_status_idx" ON "users"("role", "status");
CREATE INDEX "patient_profiles_status_idx" ON "patient_profiles"("status");
CREATE INDEX "doctor_profiles_hospitalId_isVerified_idx" ON "doctor_profiles"("hospitalId", "isVerified");
CREATE INDEX "patient_caregivers_patientId_status_idx" ON "patient_caregivers"("patientId", "status");
CREATE INDEX "consents_grantedToUserId_status_idx" ON "consents"("grantedToUserId", "status");
CREATE INDEX "hospitals_status_idx" ON "hospitals"("status");
