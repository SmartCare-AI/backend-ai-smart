import { Injectable } from '@nestjs/common';
import {
  AlertStatus,
  EmergencyStatus,
  MedicationDoseStatus,
  Role,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Phase G — read-only aggregates for the hospital dashboard.
 * Pure Prisma groupBy/count queries; no state, no writes, no PII
 * (aggregates + doctor display names only).
 */
@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  private windowStart(days: number): Date {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  }

  /** Platform-wide headline numbers for the dashboard landing page. */
  async overview(days: number) {
    const since = this.windowStart(days);
    const [
      patients,
      doctors,
      caregivers,
      appointmentsByStatus,
      visits,
      activeAlerts,
      activeEmergencies,
      doseCounts,
    ] = await Promise.all([
      this.prisma.patientProfile.count(),
      this.prisma.doctorProfile.count(),
      this.prisma.user.count({ where: { role: Role.CAREGIVER } }),
      this.prisma.appointment.groupBy({
        by: ['status'],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
      }),
      this.prisma.visit.count({ where: { date: { gte: since } } }),
      this.prisma.alert.count({ where: { status: AlertStatus.ACTIVE } }),
      this.prisma.emergencyEvent.count({
        where: { status: EmergencyStatus.ACTIVE },
      }),
      this.prisma.medicationDose.groupBy({
        by: ['status'],
        where: { scheduledAt: { gte: since, lte: new Date() } },
        _count: { _all: true },
      }),
    ]);

    const doses = Object.fromEntries(
      doseCounts.map((g) => [g.status, g._count._all]),
    ) as Partial<Record<MedicationDoseStatus, number>>;
    const taken = doses.TAKEN ?? 0;
    const missed = doses.MISSED ?? 0;

    return {
      windowDays: days,
      users: { patients, doctors, caregivers },
      appointments: Object.fromEntries(
        appointmentsByStatus.map((g) => [g.status, g._count._all]),
      ),
      visits,
      activeAlerts,
      activeEmergencies,
      adherence: {
        taken,
        missed,
        score:
          taken + missed > 0
            ? Math.round((taken / (taken + missed)) * 100) / 100
            : null,
      },
    };
  }

  /** Appointments + visits per doctor — who is overloaded, who is idle. */
  async doctorLoad(days: number) {
    const since = this.windowStart(days);
    const [appointments, visits, doctors] = await Promise.all([
      this.prisma.appointment.groupBy({
        by: ['doctorId'],
        where: { scheduledAt: { gte: since } },
        _count: { _all: true },
      }),
      this.prisma.visit.groupBy({
        by: ['doctorId'],
        where: { date: { gte: since } },
        _count: { _all: true },
      }),
      this.prisma.doctorProfile.findMany({
        select: {
          id: true,
          specialization: true,
          department: { select: { name: true } },
          hospital: { select: { name: true } },
          user: { select: { firstName: true, lastName: true } },
        },
      }),
    ]);

    const appointmentCounts = new Map(
      appointments.map((g) => [g.doctorId, g._count._all]),
    );
    const visitCounts = new Map(visits.map((g) => [g.doctorId, g._count._all]));

    return {
      windowDays: days,
      doctors: doctors
        .map((d) => ({
          doctorId: d.id,
          name: `${d.user.firstName} ${d.user.lastName}`.trim(),
          specialization: d.specialization,
          department: d.department?.name ?? null,
          hospital: d.hospital?.name ?? null,
          appointments: appointmentCounts.get(d.id) ?? 0,
          visits: visitCounts.get(d.id) ?? 0,
        }))
        .sort((a, b) => b.appointments - a.appointments),
    };
  }

  /**
   * Medication adherence per department (via prescribing doctor).
   * Departments are few, so one groupBy per department is fine.
   */
  async adherenceByDepartment(days: number) {
    const since = this.windowStart(days);
    const departments = await this.prisma.department.findMany({
      where: { isActive: true },
      select: { id: true, name: true, hospital: { select: { name: true } } },
    });

    const rows = await Promise.all(
      departments.map(async (dept) => {
        const grouped = await this.prisma.medicationDose.groupBy({
          by: ['status'],
          where: {
            scheduledAt: { gte: since, lte: new Date() },
            prescriptionItem: {
              prescription: { doctor: { departmentId: dept.id } },
            },
          },
          _count: { _all: true },
        });
        const counts = Object.fromEntries(
          grouped.map((g) => [g.status, g._count._all]),
        ) as Partial<Record<MedicationDoseStatus, number>>;
        const taken = counts.TAKEN ?? 0;
        const missed = counts.MISSED ?? 0;
        return {
          departmentId: dept.id,
          department: dept.name,
          hospital: dept.hospital.name,
          taken,
          missed,
          score:
            taken + missed > 0
              ? Math.round((taken / (taken + missed)) * 100) / 100
              : null,
        };
      }),
    );

    return { windowDays: days, departments: rows };
  }

  /**
   * Readmission rate: of the patients seen in the window, how many came
   * back within 30 days of a previous visit. A classic quality-of-care KPI.
   */
  async readmissions(days: number) {
    const since = this.windowStart(days);
    const visits = await this.prisma.visit.findMany({
      where: { date: { gte: since } },
      select: { patientId: true, date: true },
      orderBy: { date: 'asc' },
    });

    const byPatient = new Map<number, Date[]>();
    for (const visit of visits) {
      const list = byPatient.get(visit.patientId) ?? [];
      list.push(visit.date);
      byPatient.set(visit.patientId, list);
    }

    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
    let readmitted = 0;
    for (const dates of byPatient.values()) {
      for (let i = 1; i < dates.length; i++) {
        if (dates[i].getTime() - dates[i - 1].getTime() <= THIRTY_DAYS) {
          readmitted++;
          break;
        }
      }
    }

    const patientsSeen = byPatient.size;
    return {
      windowDays: days,
      patientsSeen,
      readmittedWithin30Days: readmitted,
      readmissionRate:
        patientsSeen > 0
          ? Math.round((readmitted / patientsSeen) * 100) / 100
          : null,
    };
  }
}
