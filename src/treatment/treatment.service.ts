import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ConsentType,
  EntityStatus,
  MedicineTrackingStatus,
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
  SearchMedicinesDto,
  SkipDoseDto,
  UpdatePlanStatusDto,
} from './dto/treatment.dtos';

/**
 * Intake hours per frequency — spread over waking hours, expressed in UTC
 * for MVP (the mobile app localizes display).
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
  // Treatment plans (ERD #17)
  // -------------------------------------------------------------------------

  async createPlan(requester: AuthenticatedUser, dto: CreateTreatmentPlanDto) {
    const doctor = await this.profiles.getDoctorByUserId(requester.id);
    // Requires a treating relationship with the patient.
    await this.consent.assertCanAccessPatient(
      requester,
      dto.patientId,
      ConsentType.VIEW_RECORDS,
    );

    // BR-006: the optional diagnosis must belong to this patient's record.
    if (dto.diagnosisId) {
      const diagnosis = await this.prisma.diagnosis.findUnique({
        where: { id: dto.diagnosisId },
        select: { visit: { select: { appointment: { select: { patientId: true } } } } },
      });
      if (!diagnosis) throw new NotFoundException('Diagnosis not found.');
      if (diagnosis.visit.appointment.patientId !== dto.patientId) {
        throw new BadRequestException(
          'diagnosisId does not belong to this patient.',
        );
      }
    }

    return this.prisma.treatmentPlan.create({
      data: {
        patientId: dto.patientId,
        doctorId: doctor.id,
        diagnosisId: dto.diagnosisId ?? null,
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
        include: {
          prescriptions: { select: { id: true, status: true, date: true } },
          diagnosis: { select: { id: true, name: true, code: true } },
          doctor: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              specialization: true,
            },
          },
        },
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
  // Prescriptions (ERD #18) + automatic MedicineTracking schedule
  // -------------------------------------------------------------------------

  /**
   * BR-007: a prescription always belongs to a treatment plan, which supplies
   * the patient and the prescribing doctor. Creating it also generates the
   * full intake schedule (MedicineTracking, ERD #21) that drives reminders
   * and adherence analytics.
   */
  async createPrescription(
    requester: AuthenticatedUser,
    dto: CreatePrescriptionDto,
  ) {
    const doctor = await this.profiles.getDoctorByUserId(requester.id);
    const plan = await this.prisma.treatmentPlan.findUnique({
      where: { id: dto.treatmentPlanId },
      select: { id: true, patientId: true, doctorId: true, status: true },
    });
    if (!plan) throw new NotFoundException('Treatment plan not found.');
    if (plan.doctorId !== doctor.id) {
      throw new ForbiddenException('This treatment plan belongs to another doctor.');
    }
    if (plan.status !== TreatmentPlanStatus.ACTIVE) {
      throw new BadRequestException(
        `Cannot prescribe on a ${plan.status} treatment plan.`,
      );
    }
    await this.consent.assertCanAccessPatient(
      requester,
      plan.patientId,
      ConsentType.VIEW_RECORDS,
    );

    const prescription = await this.prisma.$transaction(async (tx) => {
      const created = await tx.prescription.create({
        data: {
          treatmentPlanId: plan.id,
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
            route: item.route ?? null,
            duration: `${item.durationDays} days`,
            instructions: item.instructions,
          },
        });

        // The clever bit: one MedicineTracking row per scheduled intake.
        // These rows ARE the adherence data and drive the reminders.
        await tx.medicineTracking.createMany({
          data: this.generateSchedule(item).map((scheduledTime) => ({
            prescriptionItemId: prescriptionItem.id,
            patientId: plan.patientId,
            scheduledTime,
          })),
        });
      }
      return created;
    });

    const patient = await this.prisma.patientProfile.findUnique({
      where: { id: plan.patientId },
      select: { userId: true },
    });
    if (patient) {
      await this.notifications.notify(patient.userId, {
        type: NotificationType.MEDICATION_REMINDER,
        title: 'New prescription',
        message: `Your doctor prescribed ${dto.items.length} medication(s). Reminders are scheduled.`,
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
    const where: Prisma.PrescriptionWhereInput = {
      treatmentPlan: { patientId },
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.prescription.findMany({
        where,
        include: {
          items: { include: { medicine: true } },
          treatmentPlan: {
            select: {
              id: true,
              description: true,
              patientId: true,
              doctor: {
                select: { id: true, firstName: true, lastName: true },
              },
            },
          },
        },
        orderBy: { date: 'desc' },
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
      prescription.treatmentPlan.patientId,
      ConsentType.VIEW_RECORDS,
    );
    return prescription;
  }

  // -------------------------------------------------------------------------
  // Medicine catalog (ERD #19)
  // -------------------------------------------------------------------------

  async searchMedicines(query: SearchMedicinesDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.MedicineWhereInput = {
      status: EntityStatus.ACTIVE,
      ...(query.form ? { form: query.form } : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: Prisma.QueryMode.insensitive } },
              {
                genericName: {
                  contains: query.q,
                  mode: Prisma.QueryMode.insensitive,
                },
              },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.medicine.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.medicine.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  // -------------------------------------------------------------------------
  // Medicine tracking (ERD #21, patient side)
  // -------------------------------------------------------------------------

  async upcomingDoses(requester: AuthenticatedUser, hours: number) {
    const patient = await this.profiles.getPatientByUserId(requester.id);
    return this.prisma.medicineTracking.findMany({
      where: {
        patientId: patient.id,
        status: MedicineTrackingStatus.SCHEDULED,
        scheduledTime: {
          gte: new Date(Date.now() - 60 * 60 * 1000), // still takeable (1h grace)
          lte: new Date(Date.now() + hours * 60 * 60 * 1000),
        },
      },
      include: {
        prescriptionItem: { include: { medicine: true } },
      },
      orderBy: { scheduledTime: 'asc' },
    });
  }

  async takeDose(requester: AuthenticatedUser, trackingId: number) {
    const dose = await this.getOwnDose(requester, trackingId);
    return this.prisma.medicineTracking.update({
      where: { id: dose.id },
      data: {
        status: MedicineTrackingStatus.TAKEN,
        takenTime: new Date(),
      },
    });
  }

  /** ERD MedicineTracking.Status SKIPPED — a deliberate, recorded omission. */
  async skipDose(
    requester: AuthenticatedUser,
    trackingId: number,
    dto: SkipDoseDto,
  ) {
    const dose = await this.getOwnDose(requester, trackingId);
    return this.prisma.medicineTracking.update({
      where: { id: dose.id },
      data: { status: MedicineTrackingStatus.SKIPPED, notes: dto.notes },
    });
  }

  /**
   * Adherence score over a window: TAKEN / (TAKEN + MISSED).
   * The doctor-dashboard number that shows whether treatment is followed.
   */
  async adherence(
    requester: AuthenticatedUser,
    patientId: number,
    days: number,
  ) {
    await this.consent.assertCanAccessPatient(
      requester,
      patientId,
      ConsentType.VIEW_RECORDS,
    );
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const grouped = await this.prisma.medicineTracking.groupBy({
      by: ['status'],
      where: { patientId, scheduledTime: { gte: since, lte: new Date() } },
      _count: { _all: true },
    });
    const counts = Object.fromEntries(
      grouped.map((g) => [g.status, g._count._all]),
    ) as Partial<Record<MedicineTrackingStatus, number>>;

    const taken = counts.TAKEN ?? 0;
    const missed = counts.MISSED ?? 0;
    const settled = taken + missed;
    return {
      patientId,
      windowDays: days,
      taken,
      missed,
      skipped: counts.SKIPPED ?? 0,
      upcoming: counts.SCHEDULED ?? 0,
      /** 0..1, null when no settled doses in the window */
      score: settled > 0 ? Math.round((taken / settled) * 100) / 100 : null,
    };
  }

  // -------------------------------------------------------------------------

  private async getOwnDose(requester: AuthenticatedUser, trackingId: number) {
    const patient = await this.profiles.getPatientByUserId(requester.id);
    const dose = await this.prisma.medicineTracking.findUnique({
      where: { id: trackingId },
    });
    if (!dose || dose.patientId !== patient.id) {
      throw new NotFoundException('Dose not found.');
    }
    if (dose.status !== MedicineTrackingStatus.SCHEDULED) {
      throw new BadRequestException(`Dose is already ${dose.status}.`);
    }
    return dose;
  }

  private generateSchedule(item: PrescriptionItemDto): Date[] {
    const hours = SLOT_HOURS[item.timesPerDay];
    const dates: Date[] = [];
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    for (let day = 1; day <= item.durationDays; day++) {
      for (const hour of hours) {
        dates.push(
          new Date(
            start.getTime() + day * 24 * 60 * 60 * 1000 + hour * 60 * 60 * 1000,
          ),
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
    if (existing) {
      // Enrich the catalog entry when the doctor supplies a generic name.
      if (item.genericName && !existing.genericName) {
        return tx.medicine.update({
          where: { id: existing.id },
          data: { genericName: item.genericName },
        });
      }
      return existing;
    }
    return tx.medicine.create({
      data: {
        name: item.medicineName,
        genericName: item.genericName ?? null,
        form: item.form ?? null,
        strength: item.strength ?? null,
      },
    });
  }

  private async getPrescriptionWithItems(id: number) {
    const prescription = await this.prisma.prescription.findUnique({
      where: { id },
      include: {
        items: { include: { medicine: true } },
        treatmentPlan: {
          select: {
            id: true,
            description: true,
            patientId: true,
            doctorId: true,
          },
        },
      },
    });
    if (!prescription) throw new NotFoundException('Prescription not found.');
    return prescription;
  }
}
