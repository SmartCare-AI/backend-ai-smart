-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED');

-- CreateTable
CREATE TABLE "caregiver_invitations" (
    "id" SERIAL NOT NULL,
    "patientId" INTEGER NOT NULL,
    "email" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "permissionLevel" "ConsentType" NOT NULL DEFAULT 'RECEIVE_ALERTS',
    "accessEndDate" TIMESTAMP(3),
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "acceptedByUserId" INTEGER,

    CONSTRAINT "caregiver_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "caregiver_invitations_email_status_idx" ON "caregiver_invitations"("email", "status");

-- CreateIndex
CREATE INDEX "caregiver_invitations_patientId_status_idx" ON "caregiver_invitations"("patientId", "status");

-- AddForeignKey
ALTER TABLE "caregiver_invitations" ADD CONSTRAINT "caregiver_invitations_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patient_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
