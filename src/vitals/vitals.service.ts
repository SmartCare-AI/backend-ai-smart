import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { ConsentType, RiskLevel, VitalSign, VitalSource } from '@prisma/client';
import { AlertsService } from '../alerts/alerts.service';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ConsentService } from '../consent/consent.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProfilesService } from '../users/profiles.service';
import {
  RecordVitalDto,
  RecordVitalsBatchDto,
  VitalsSeriesQueryDto,
} from './dto/vital.dtos';
import { evaluateVital } from './vital-thresholds';

@Injectable()
export class VitalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly consent: ConsentService,
    private readonly profiles: ProfilesService,
    private readonly alerts: AlertsService,
  ) {}

  async record(requester: AuthenticatedUser, dto: RecordVitalDto) {
    const patient = await this.profiles.getPatientByUserId(requester.id);
    await this.assertDeviceOwnership(patient.id, dto.deviceId);

    const vital = await this.prisma.vitalSign.create({
      data: {
        patientId: patient.id,
        type: dto.type,
        value: dto.value,
        unit: dto.unit,
        source: dto.deviceId ? VitalSource.DEVICE : VitalSource.MANUAL,
        deviceId: dto.deviceId ?? null,
        measuredAt: dto.measuredAt ? new Date(dto.measuredAt) : new Date(),
      },
    });

    await this.checkThreshold(vital);
    return vital;
  }

  /** Device sync — one alert max per vital type per batch (worst reading). */
  async recordBatch(requester: AuthenticatedUser, dto: RecordVitalsBatchDto) {
    const patient = await this.profiles.getPatientByUserId(requester.id);
    const deviceIds = [...new Set(dto.readings.map((r) => r.deviceId).filter(Boolean))];
    for (const deviceId of deviceIds) {
      await this.assertDeviceOwnership(patient.id, deviceId as number);
    }

    const created: VitalSign[] = [];
    for (const reading of dto.readings) {
      created.push(
        await this.prisma.vitalSign.create({
          data: {
            patientId: patient.id,
            type: reading.type,
            value: reading.value,
            unit: reading.unit,
            source: reading.deviceId ? VitalSource.DEVICE : VitalSource.MANUAL,
            deviceId: reading.deviceId ?? null,
            measuredAt: reading.measuredAt ? new Date(reading.measuredAt) : new Date(),
          },
        }),
      );
    }

    // Evaluate only the worst violation per type — a 100-point sync must
    // not fire 100 alerts.
    const worstByType = new Map<string, VitalSign>();
    for (const vital of created) {
      const violation = evaluateVital(vital.type, vital.value);
      if (!violation) continue;
      const current = worstByType.get(vital.type);
      const currentSeverity = current
        ? evaluateVital(current.type, current.value)?.severity
        : undefined;
      if (!current || (violation.severity === RiskLevel.CRITICAL && currentSeverity !== RiskLevel.CRITICAL)) {
        worstByType.set(vital.type, vital);
      }
    }
    for (const vital of worstByType.values()) {
      await this.checkThreshold(vital);
    }

    return { recorded: created.length };
  }

  /** Time-series for charts — ascending, capped, filterable. */
  async series(
    requester: AuthenticatedUser,
    patientId: number,
    query: VitalsSeriesQueryDto,
  ) {
    await this.consent.assertCanAccessPatient(
      requester,
      patientId,
      ConsentType.VIEW_RECORDS,
    );
    const items = await this.prisma.vitalSign.findMany({
      where: {
        patientId,
        ...(query.type ? { type: query.type } : {}),
        measuredAt: {
          ...(query.from ? { gte: new Date(query.from) } : {}),
          ...(query.to ? { lte: new Date(query.to) } : {}),
        },
      },
      orderBy: { measuredAt: 'asc' },
      take: query.take ?? 500,
      select: {
        id: true,
        type: true,
        value: true,
        unit: true,
        source: true,
        measuredAt: true,
      },
    });
    return { patientId, count: items.length, items };
  }

  // -------------------------------------------------------------------------

  private async checkThreshold(vital: VitalSign) {
    const violation = evaluateVital(vital.type, vital.value);
    if (!violation) return;

    const typeLabel = vital.type.toLowerCase().replace(/_/g, ' ');
    await this.alerts.raise({
      patientId: vital.patientId,
      title: `Abnormal ${typeLabel}: ${vital.value} ${vital.unit}`,
      description: `Measured ${typeLabel} of ${vital.value} ${vital.unit} is ${violation.bound} the safe range.`,
      severity: violation.severity,
      source: `vital_threshold:${vital.type}`,
      vitalSignId: vital.id,
    });
  }

  private async assertDeviceOwnership(patientId: number, deviceId?: number) {
    if (!deviceId) return;
    const device = await this.prisma.device.findUnique({
      where: { id: deviceId },
      select: { patientId: true, isActive: true },
    });
    if (!device || device.patientId !== patientId || !device.isActive) {
      throw new BadRequestException('deviceId does not belong to you or is inactive.');
    }
  }
}
