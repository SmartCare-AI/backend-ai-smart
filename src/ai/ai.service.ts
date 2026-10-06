import { Inject, Injectable } from '@nestjs/common';
import {
  AlertStatus,
  AlertType,
  AssessmentType,
  ConsentType,
  EmergencyStatus,
  EmergencyType,
  RiskLevel,
} from '@prisma/client';
import { AlertsService } from '../alerts/alerts.service';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ConsentService } from '../consent/consent.service';
import { PrismaService } from '../prisma/prisma.service';
import { TreatmentService } from '../treatment/treatment.service';
import { ProfilesService } from '../users/profiles.service';
import { evaluateVital } from '../vitals/vital-thresholds';
import { TriageRequestDto } from './dto/ai.dtos';
import { AI_PROVIDER, TriageInput } from './providers/ai-provider.interface';
import type { AiProvider } from './providers/ai-provider.interface';
import { maxRisk } from './providers/rules.provider';

@Injectable()
export class AiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly profiles: ProfilesService,
    private readonly consent: ConsentService,
    private readonly treatment: TreatmentService,
    private readonly alerts: AlertsService,
    @Inject(AI_PROVIDER) private readonly ai: AiProvider,
  ) {}

  /**
   * Patient symptom triage: assistive risk assessment + specialty
   * suggestion — never a diagnosis. The result is persisted as an
   * AI_INITIAL Assessment so the doctor sees it at the next visit.
   *
   * A CRITICAL result also raises a CRITICAL alert, which opens an emergency:
   * the care circle is notified and SMS escalation is armed, exactly like a
   * critical vital sign.
   */
  async triage(requester: AuthenticatedUser, dto: TriageRequestDto) {
    const patient = await this.profiles.getPatientByUserId(requester.id);

    // Data minimization: the engine gets clinical context only — no names,
    // emails, or ids leave this service. Demographics come from the patient
    // profile, which is where the ERD puts them.
    const input: TriageInput = {
      age: patient.dateOfBirth
        ? Math.floor(
            (Date.now() - patient.dateOfBirth.getTime()) /
              (365.25 * 24 * 60 * 60 * 1000),
          )
        : null,
      gender: patient.gender ?? null,
      chronicDiseases: patient.chronicDiseases,
      symptoms: dto.symptoms,
      notes: dto.notes ?? null,
    };

    const result = await this.ai.triage(input);

    const assessment = await this.prisma.assessment.create({
      data: {
        patientId: patient.id,
        type: AssessmentType.AI_INITIAL,
        symptoms: JSON.stringify(dto.symptoms),
        riskLevel: result.riskLevel,
        suggestedSpecialty: result.suggestedSpecialty,
        notes: dto.notes ?? null,
        observations: result.reasons.join(' '),
        aiEngine: result.engine,
      },
      select: { id: true, date: true },
    });

    let emergencyAlertId: number | null = null;
    if (result.riskLevel === RiskLevel.CRITICAL) {
      const alert = await this.alerts.raise({
        patientId: patient.id,
        type: AlertType.AI_RISK,
        severity: RiskLevel.CRITICAL,
        title: 'AI triage: critical symptoms reported',
        description: [
          `Symptoms: ${dto.symptoms.map((s) => s.name).join(', ')}.`,
          result.redFlags.length
            ? `Red flags: ${result.redFlags.join(', ')}.`
            : '',
        ]
          .join(' ')
          .trim(),
        source: 'ai_triage',
        emergencyType: EmergencyType.OTHER,
      });
      emergencyAlertId = alert?.id ?? null;
    }

    return {
      assessmentId: assessment.id,
      ...result,
      /** Set when a CRITICAL result alerted the care circle. */
      emergencyAlertId,
      /** Doctor search filter for the suggested specialty (see GET /doctors). */
      doctorSearch: { specialization: result.suggestedSpecialty },
      disclaimer:
        'Assistive assessment only — not a medical diagnosis. Always consult a doctor.',
    };
  }

  /**
   * Deterministic risk snapshot from live record data: recent vitals vs
   * clinical thresholds, active alerts, medication adherence, and open
   * emergencies. No ML involved — fully explainable via `factors`.
   */
  async risk(requester: AuthenticatedUser, patientId: number) {
    await this.consent.assertCanAccessPatient(
      requester,
      patientId,
      ConsentType.VIEW_RECORDS,
    );

    const since = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const [vitals, activeAlerts, activeEmergencies, adherence] =
      await Promise.all([
        this.prisma.vitalSign.findMany({
          where: { patientId, measuredAt: { gte: since } },
          orderBy: { measuredAt: 'desc' },
          take: 200,
        }),
        this.prisma.alert.findMany({
          where: {
            patientId,
            status: { in: [AlertStatus.NEW, AlertStatus.ACKNOWLEDGED] },
          },
          select: { title: true, severity: true },
        }),
        this.prisma.emergencyEvent.count({
          where: { patientId, status: EmergencyStatus.ACTIVE },
        }),
        this.treatment.adherence(requester, patientId, 30),
      ]);

    let risk: RiskLevel = RiskLevel.LOW;
    const factors: { severity: RiskLevel; reason: string }[] = [];

    // Latest reading per vital type (list is newest-first).
    const latestPerType = new Map<string, (typeof vitals)[number]>();
    for (const vital of vitals) {
      if (!latestPerType.has(vital.type)) latestPerType.set(vital.type, vital);
    }
    for (const vital of latestPerType.values()) {
      const violation = evaluateVital(vital.type, vital.value);
      if (!violation) continue;
      risk = maxRisk(risk, violation.severity);
      factors.push({
        severity: violation.severity,
        reason: `${vital.type} is ${vital.value} ${vital.unit} (${violation.bound}).`,
      });
    }

    for (const alert of activeAlerts) {
      risk = maxRisk(risk, alert.severity);
      factors.push({
        severity: alert.severity,
        reason: `Active alert: ${alert.title}`,
      });
    }

    if (adherence.score !== null && adherence.score < 0.5) {
      risk = maxRisk(risk, RiskLevel.MODERATE);
      factors.push({
        severity: RiskLevel.MODERATE,
        reason: `Medication adherence is low (${Math.round(adherence.score * 100)}% over 30 days).`,
      });
    }

    if (activeEmergencies > 0) {
      risk = RiskLevel.CRITICAL;
      factors.push({
        severity: RiskLevel.CRITICAL,
        reason: `${activeEmergencies} unresolved emergency event(s).`,
      });
    }

    return {
      patientId,
      riskLevel: risk,
      factors,
      adherenceScore: adherence.score,
      computedAt: new Date(),
    };
  }
}
