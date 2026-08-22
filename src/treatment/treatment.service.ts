import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ConsentType,
  MedicationDoseStatus,
  NotificationType,
  Prisma,
  TreatmentPlanStatus,
} from '@prisma/client';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ConsentService } from '../consent/consent.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProfilesService } from '../users/profiles.service';
import {
  CreatePrescriptionDto,
  CreateTreatmentPlanDto,
  PrescriptionItemDto,
  UpdatePlanStatusDto,
} from './dto/treatment.dtos';

/**
 * Intake hours per frequency — spread over waking hours, expressed in UTC
 * for MVP (the mobile app localizes display; see File.md UTC rule).
 */
const SLOT_HOURS: Record<number, number[]> = {
  1: [9],
  2: [9, 21],
  3: [8, 14, 20],
  4: [8, 12, 16, 20],
  5: [8, 11, 14, 17, 20],
  6: [8, 11, 14, 17, 20, 23],
};

@Injectable()
export class TreatmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly consent: ConsentService,
    private readonly profiles: ProfilesService,
    private readonly notifications: NotificationsService,
  ) {}

  // -------------------------------------------------------------------------
  // Treatment plans
  // -------------------------------------------------------------------------

  async createPlan(requester: AuthenticatedUser, dto: CreateTreatmentPlanDto) {
    const doctor = await this.profiles.getDoctorByUserId(requester.id);
    // Requires a treating relationship with the patient.
    await this.consent.assertCanAccessPatient(
      requester,
      dto.patientId,
      ConsentType.VIEW_RECORDS,
    );

    return this.prisma.treatmentPlan.create({
      data: {
        patientId: dto.patientId,
        doctorId: doctor.id,
        visitId: dto.visitId ?? null,
        diagnosisId: dto.diagnosisId ?? null,
        title: dto.title,
        description: dto.description,
        goals: dto.goals,
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        notes: dto.notes,
      },
    });
  }

  async listPlans(
    requester: AuthenticatedUser,
    patientId: number,
    page: number,
    limit: number,
  ) {
    await this.consent.assertCanAccessPatient(
      requester,
      patientId,
      ConsentType.VIEW_RECORDS,
    );
    const where = { patientId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.treatmentPlan.findMany({
        where,
        include: { prescriptions: { select: { id: true, status: true } } },
        orderBy: { startDate: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.treatmentPlan.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  async updatePlanStatus(
    requester: AuthenticatedUser,
    id: number,
    dto: UpdatePlanStatusDto,
  ) {
    const plan = await this.prisma.treatmentPlan.findUnique({ where: { id } });
    if (!plan) throw new NotFoundException('Treatment plan not found.');
    const doctor = await this.profiles.getDoctorByUserId(requester.id);
    if (plan.doctorId !== doctor.id) {
      throw new ForbiddenException('This plan belongs to another doctor.');
    }
    return this.prisma.treatmentPlan.update({
      where: { id },
      data: {
        status: dto.status,
        endDate:
          dto.status === TreatmentPlanStatus.COMPLETED && !plan.endDate
            ? new Date()
            : plan.endDate,
      },
    });
  }

  // -------------------------------------------------------------------------
  // Prescriptions (+ automatic dose schedule)
  // -------------------------------------------------------------------------

  async createPrescription(
    requester: AuthenticatedUser,
    dto: CreatePrescriptionDto,
  ) {
    const doctor = await this.profiles.getDoctorByUserId(requester.id);
    await this.consent.assertCanAccessPatient(
      requester,
      dto.patientId,
      ConsentType.VIEW_RECORDS,
    );
    if (dto.treatmentPlanId) {
      const plan = await this.prisma.treatmentPlan.findUnique({
        where: { id: dto.treatmentPlanId },
        select: { patientId: true },
      });
      if (!plan || plan.patientId !== dto.patientId) {
        throw new BadRequestException('treatmentPlanId does not belong to this patient.');
      }
    }

    const prescription = await this.prisma.$transaction(async (tx) => {
      const created = await tx.prescription.create({
        data: {
          patientId: dto.patientId,
          doctorId: doctor.id,
          treatmentPlanId: dto.treatmentPlanId ?? null,
          instructions: dto.instructions,
          notes: dto.notes,
        },
      });

      for (const item of dto.items) {
        const medicine = await this.findOrCreateMedicine(tx, item);
        const prescriptionItem = await tx.prescriptionItem.create({
          data: {
            prescriptionId: created.id,
            medicineId: medicine.id,
            dose: item.dose,
            frequency: `${item.timesPerDay}x daily`,
            route: item.route,
            duration: `${item.durationDays} days`,
            instructions: item.instructions,
          },
        });

        // The clever bit: one MedicationDose row per scheduled intake.
        // These rows ARE the adherence data and drive Phase C reminders.
        await tx.medicationDose.createMany({
          data: this.generateSchedule(item).map((scheduledAt) => ({
            prescriptionItemId: prescriptionItem.id,
            patientId: dto.patientId,
            scheduledAt,
          })),
        });
      }
      return created;
    });

    const patient = await this.prisma.patientProfile.findUnique({
      where: { id: dto.patientId },
      select: { userId: true },
    });
    if (patient) {
      await this.notifications.notify(patient.userId, {
        type: NotificationType.MEDICATION_REMINDER,
        title: 'New prescription',
        body: `Your doctor prescribed ${dto.items.length} medication(s). Reminders are scheduled.`,
        data: { screen: 'prescriptions', id: String(prescription.id) },
      });
    }
    return this.getPrescriptionWithItems(prescription.id);
  }

  async listPrescriptions(
    requester: AuthenticatedUser,
    patientId: number,
    page: number,
    limit: number,
  ) {
    await this.consent.assertCanAccessPatient(
      requester,
      patientId,
      ConsentType.VIEW_RECORDS,
    );
    const where = { patientId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.prescription.findMany({
        where,
        include: { items: { include: { medicine: true } } },
        orderBy: { issuedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.prescription.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  async getPrescription(requester: AuthenticatedUser, id: number) {
    const prescription = await this.getPrescriptionWithItems(id);
    await this.consent.assertCanAccessPatient(
      requester,
      prescription.patientId,
      ConsentType.VIEW_RECORDS,
    );
    return prescription;
  }

  // -------------------------------------------------------------------------
  // Medication doses (patient side)
  // -------------------------------------------------------------------------

  async upcomingDoses(requester: AuthenticatedUser, hours: number) {
    const patient = await this.profiles.getPatientByUserId(requester.id);
    return this.prisma.medicationDose.findMany({
      where: {
        patientId: patient.id,
        status: MedicationDoseStatus.SCHEDULED,
        scheduledAt: {
          gte: new Date(Date.now() - 60 * 60 * 1000), // still takeable (1h grace)
          lte: new Date(Date.now() + hours * 60 * 60 * 1000),
        },
      },
      include: {
        prescriptionItem: { include: { medicine: true } },
      },
      orderBy: { scheduledAt: 'asc' },
    });
  }

  async takeDose(requester: AuthenticatedUser, doseId: number) {
    const patient = await this.profiles.getPatientByUserId(requester.id);
    const dose = await this.prisma.medicationDose.findUnique({
      where: { id: doseId },
    });
    if (!dose || dose.patientId !== patient.id) {
      throw new NotFoundException('Dose not found.');
    }
    if (dose.status !== MedicationDoseStatus.SCHEDULED) {
      throw new BadRequestException(`Dose is already ${dose.status}.`);
    }
    return this.prisma.medicationDose.update({
      where: { id: doseId },
      data: { status: MedicationDoseStatus.TAKEN, takenAt: new Date() },
    });
  }

  // -------------------------------------------------------------------------

  private generateSchedule(item: PrescriptionItemDto): Date[] {
    const hours = SLOT_HOURS[item.timesPerDay];
    const dates: Date[] = [];
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    for (let day = 1; day <= item.durationDays; day++) {
      for (const hour of hours) {
        dates.push(
          new Date(start.getTime() + day * 24 * 60 * 60 * 1000 + hour * 60 * 60 * 1000),
        );
      }
    }
    return dates;
  }

  private async findOrCreateMedicine(
    tx: Prisma.TransactionClient,
    item: PrescriptionItemDto,
  ) {
    const existing = await tx.medicine.findFirst({
      where: {
        name: item.medicineName,
        form: item.form ?? null,
        strength: item.strength ?? null,
      },
    });
    if (existing) return existing;
    return tx.medicine.create({
      data: {
        name: item.medicineName,
        form: item.form ?? null,
        strength: item.strength ?? null,
      },
    });
  }

  private async getPrescriptionWithItems(id: number) {
    const prescription = await this.prisma.prescription.findUnique({
      where: { id },
      include: { items: { include: { medicine: true } } },
    });
    if (!prescription) throw new NotFoundException('Prescription not found.');
    return prescription;
  }
}
