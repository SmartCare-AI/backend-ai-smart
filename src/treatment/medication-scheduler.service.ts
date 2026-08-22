import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  MedicationDoseStatus,
  NotificationType,
  RiskLevel,
} from '@prisma/client';
import { AlertsService } from '../alerts/alerts.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

const REMINDER_WINDOW_MIN = 15; // remind up to 15 min before the dose
const MISSED_AFTER_MIN = 60; // dose counts as missed 60 min past schedule
const CONSECUTIVE_MISSED_FOR_ALERT = 3;

/**
 * The adherence engine (File.md Phase C). Every minute:
 *  1. Reminders  — push "time for your medication" for doses due soon.
 *  2. Missed     — doses >60 min overdue become MISSED; three consecutive
 *                  missed doses raise a HIGH alert to doctor + caregivers
 *                  (the Family Portal promise).
 *
 * Runs in-process via @nestjs/schedule — no external infra needed; the
 * single-instance PM2 deployment makes this safe. (Multi-instance would
 * move this onto the BullMQ 'reminders' queue.)
 */
@Injectable()
export class MedicationSchedulerService {
  private readonly logger = new Logger(MedicationSchedulerService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly alerts: AlertsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick() {
    if (this.running) return; // never overlap slow ticks
    this.running = true;
    try {
      await this.sendReminders();
      await this.detectMissed();
    } catch (err) {
      this.logger.error(`Scheduler tick failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  // -------------------------------------------------------------------------

  private async sendReminders() {
    const now = new Date();
    const due = await this.prisma.medicationDose.findMany({
      where: {
        status: MedicationDoseStatus.SCHEDULED,
        reminderSentAt: null,
        scheduledAt: {
          // Don't resurrect ancient reminders after downtime; missed
          // detection owns anything older.
          gte: new Date(now.getTime() - REMINDER_WINDOW_MIN * 60_000),
          lte: new Date(now.getTime() + REMINDER_WINDOW_MIN * 60_000),
        },
      },
      include: {
        prescriptionItem: { include: { medicine: true } },
        patient: { select: { userId: true } },
      },
    });
    if (due.length === 0) return;

    // One notification per patient, listing everything due together.
    const byPatient = new Map<number, typeof due>();
    for (const dose of due) {
      const list = byPatient.get(dose.patient.userId) ?? [];
      list.push(dose);
      byPatient.set(dose.patient.userId, list);
    }

    for (const [userId, doses] of byPatient) {
      const meds = doses
        .map((d) => {
          const m = d.prescriptionItem.medicine;
          return `${m.name}${m.strength ? ` ${m.strength}` : ''} (${d.prescriptionItem.dose})`;
        })
        .join(', ');
      await this.notifications.notify(userId, {
        type: NotificationType.MEDICATION_REMINDER,
        title: 'Time for your medication 💊',
        body: meds,
        data: { screen: 'medications', doseIds: doses.map((d) => d.id).join(',') },
      });
    }

    await this.prisma.medicationDose.updateMany({
      where: { id: { in: due.map((d) => d.id) } },
      data: { reminderSentAt: now },
    });
    this.logger.log(`Sent ${due.length} dose reminder(s) to ${byPatient.size} patient(s).`);
  }

  private async detectMissed() {
    const cutoff = new Date(Date.now() - MISSED_AFTER_MIN * 60_000);
    const overdue = await this.prisma.medicationDose.findMany({
      where: {
        status: MedicationDoseStatus.SCHEDULED,
        scheduledAt: { lt: cutoff },
      },
      select: { id: true, patientId: true },
    });
    if (overdue.length === 0) return;

    await this.prisma.medicationDose.updateMany({
      where: { id: { in: overdue.map((d) => d.id) } },
      data: { status: MedicationDoseStatus.MISSED },
    });
    this.logger.log(`Marked ${overdue.length} dose(s) as MISSED.`);

    // Adherence check per affected patient: are the last N settled doses
    // all missed? (settled = anything no longer SCHEDULED)
    const patientIds = [...new Set(overdue.map((d) => d.patientId))];
    for (const patientId of patientIds) {
      const recent = await this.prisma.medicationDose.findMany({
        where: {
          patientId,
          status: { not: MedicationDoseStatus.SCHEDULED },
        },
        orderBy: { scheduledAt: 'desc' },
        take: CONSECUTIVE_MISSED_FOR_ALERT,
        select: { status: true },
      });
      const allMissed =
        recent.length === CONSECUTIVE_MISSED_FOR_ALERT &&
        recent.every((d) => d.status === MedicationDoseStatus.MISSED);
      if (!allMissed) continue;

      await this.alerts.raise({
        patientId,
        title: `${CONSECUTIVE_MISSED_FOR_ALERT} consecutive medication doses missed`,
        description:
          'The patient has stopped taking their medication. Early intervention recommended.',
        severity: RiskLevel.HIGH,
        source: 'adherence',
        cooldownHours: 24, // one adherence alarm per day is enough
      });
    }
  }
}
