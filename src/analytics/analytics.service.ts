import { Injectable } from '@nestjs/common';
import {
  AlertStatus,
  EmergencyStatus,
  EntityStatus,
  MedicineTrackingStatus,
  Role,
} from '@prisma/client';
import { fullName } from '../common/utils/user-name.util';
import { PrismaService } from '../prisma/prisma.service';

/** Alerts that still need attention (ERD Alert.Status New / Acknowledged). */
const OPEN_ALERT_STATUSES: AlertStatus[] = [
  AlertStatus.NEW,
  AlertStatus.ACKNOWLEDGED,
];

/**
 * BRD §16.2 — read-only aggregates for the hospital dashboard.
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
      onlineVisits,
      openAlerts,
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
      this.prisma.onlineVisit.count({ where: { startTime: { gte: since } } }),
      this.prisma.alert.count({
        where: { status: { in: OPEN_ALERT_STATUSES } },
      }),
      this.prisma.emergencyEvent.count({
        where: { status: EmergencyStatus.ACTIVE },
      }),
      this.prisma.medicineTracking.groupBy({
        by: ['status'],
        where: { scheduledTime: { gte: since, lte: new Date() } },
        _count: { _all: true },
      }),
    ]);

    const doses = Object.fromEntries(
      doseCounts.map((g) => [g.status, g._count._all]),
    ) as Partial<Record<MedicineTrackingStatus, number>>;
    const taken = doses.TAKEN ?? 0;
    const missed = doses.MISSED ?? 0;

    return {
      windowDays: days,
      users: { patients, doctors, caregivers },
      appointments: Object.fromEntries(
        appointmentsByStatus.map((g) => [g.status, g._count._all]),
      ),
      visits,
      onlineVisits,
      openAlerts,
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

  /**
   * Appointments + visits per doctor — who is overloaded, who is idle.
   * Visits are counted through their appointment (BR-004), since the Visit
   * entity no longer duplicates the doctor.
   */
  async doctorLoad(days: number) {
    const since = this.windowStart(days);
    const [appointments, realized, doctors] = await Promise.all([
      this.prisma.appointment.groupBy({
        by: ['doctorId'],
        where: { startTime: { gte: since } },
        _count: { _all: true },
      }),
      this.prisma.appointment.groupBy({
        by: ['doctorId'],
        where: { visit: { is: { date: { gte: since } } } },
        _count: { _all: true },
      }),
      this.prisma.doctorProfile.findMany({
        select: {
          id: true,
          firstName: true,
          lastName: true,
          specialization: true,
          department: { select: { name: true } },
          hospital: { select: { name: true } },
        },
      }),
    ]);

    const appointmentCounts = new Map(
      appointments.map((g) => [g.doctorId, g._count._all]),
    );
    const visitCounts = new Map(
      realized.map((g) => [g.doctorId, g._count._all]),
    );

    return {
      windowDays: days,
      doctors: doctors
        .map((d) => ({
          doctorId: d.id,
          name: fullName(d),
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
   * Medication adherence per department, attributed through the prescribing
   * doctor: MedicineTracking → PrescriptionItem → Prescription → TreatmentPlan
   * → Doctor → Department. Departments are few, so one groupBy each is fine.
   */
  async adherenceByDepartment(days: number) {
    const since = this.windowStart(days);
    const departments = await this.prisma.department.findMany({
      where: { status: EntityStatus.ACTIVE },
      select: { id: true, name: true, hospital: { select: { name: true } } },
    });

    const rows = await Promise.all(
      departments.map(async (dept) => {
        const grouped = await this.prisma.medicineTracking.groupBy({
          by: ['status'],
          where: {
            scheduledTime: { gte: since, lte: new Date() },
            prescriptionItem: {
              prescription: {
                treatmentPlan: { doctor: { departmentId: dept.id } },
              },
            },
          },
          _count: { _all: true },
        });
        const counts = Object.fromEntries(
          grouped.map((g) => [g.status, g._count._all]),
        ) as Partial<Record<MedicineTrackingStatus, number>>;
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
      select: { date: true, appointment: { select: { patientId: true } } },
      orderBy: { date: 'asc' },
    });

    const byPatient = new Map<number, Date[]>();
    for (const visit of visits) {
      const patientId = visit.appointment.patientId;
      const list = byPatient.get(patientId) ?? [];
      list.push(visit.date);
      byPatient.set(patientId, list);
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

  /**
   * BRD §16.2 "healthcare quality analytics": alert volume and how quickly
   * the care team closes alerts, split by severity.
   */
  async alertQuality(days: number) {
    const since = this.windowStart(days);
    const [bySeverity, resolved] = await Promise.all([
      this.prisma.alert.groupBy({
        by: ['severity', 'status'],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
      }),
      this.prisma.alert.findMany({
        where: {
          createdAt: { gte: since },
          resolvedAt: { not: null },
        },
        select: { severity: true, createdAt: true, resolvedAt: true },
      }),
    ]);

    const minutesBySeverity = new Map<string, number[]>();
    for (const alert of resolved) {
      if (!alert.resolvedAt) continue;
      const minutes =
        (alert.resolvedAt.getTime() - alert.createdAt.getTime()) / 60_000;
      const list = minutesBySeverity.get(alert.severity) ?? [];
      list.push(minutes);
      minutesBySeverity.set(alert.severity, list);
    }

    return {
      windowDays: days,
      counts: bySeverity.map((g) => ({
        severity: g.severity,
        status: g.status,
        count: g._count._all,
      })),
      meanResolutionMinutes: [...minutesBySeverity.entries()].map(
        ([severity, values]) => ({
          severity,
          resolved: values.length,
          meanMinutes:
            Math.round(
              (values.reduce((a, b) => a + b, 0) / values.length) * 10,
            ) / 10,
        }),
      ),
    };
  }
}
