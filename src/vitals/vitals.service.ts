import { BadRequestException, Injectable } from '@nestjs/common';
import {
  AlertType,
  ConsentType,
  DeviceStatus,
  Prisma,
  RiskLevel,
  VitalSign,
  VitalSource,
} from '@prisma/client';
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

/**
 * ERD #16 VitalSign — the patient's clinical measurement stream.
 *
 * A reading that comes from a paired device is written twice on purpose: the
 * raw DeviceReading (#23, owned by the Device per BR-009) and the clinical
 * VitalSign that points at it. Charts, thresholds and the AI modules read the
 * single VitalSign series regardless of origin.
 */
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

    const vital = await this.prisma.$transaction((tx) =>
      this.persistReading(tx, patient.id, dto),
    );
    await this.checkThreshold(vital);
    return vital;
  }

  /** Device sync — one alert max per vital type per batch (worst reading). */
  async recordBatch(requester: AuthenticatedUser, dto: RecordVitalsBatchDto) {
    const patient = await this.profiles.getPatientByUserId(requester.id);
    const deviceIds = [
      ...new Set(dto.readings.map((r) => r.deviceId).filter(Boolean)),
    ] as number[];
    for (const deviceId of deviceIds) {
      await this.assertDeviceOwnership(patient.id, deviceId);
    }
    const now = new Date();

    // Two bulk inserts rather than one round-trip per reading: a 100-point
    // smartwatch sync must not spend the interactive-transaction budget on
    // 200 sequential statements.
    const created = await this.prisma.$transaction(async (tx) => {
      const prepared = dto.readings.map((reading) => ({
        ...reading,
        measuredAt: reading.measuredAt ? new Date(reading.measuredAt) : now,
      }));

      const deviceBacked = prepared.filter((r) => r.deviceId);
      const rawReadings = deviceBacked.length
        ? await tx.deviceReading.createManyAndReturn({
            data: deviceBacked.map((r) => ({
              deviceId: r.deviceId!,
              type: r.type,
              value: r.value,
              unit: r.unit,
              measuredAt: r.measuredAt,
            })),
          })
        : [];
      // A single INSERT ... RETURNING gives the rows back in input order, so
      // the two lists line up one-to-one.
      const rawIds = new Map(
        deviceBacked.map((r, i) => [r, rawReadings[i].id]),
      );

      const rows = await tx.vitalSign.createManyAndReturn({
        data: prepared.map((r) => ({
          patientId: patient.id,
          type: r.type,
          value: r.value,
          unit: r.unit,
          source: r.deviceId ? VitalSource.DEVICE : VitalSource.MANUAL,
          deviceReadingId: rawIds.get(r) ?? null,
          measuredAt: r.measuredAt,
        })),
      });

      if (deviceIds.length > 0) {
        await tx.device.updateMany({
          where: { id: { in: deviceIds } },
          data: { lastSync: now },
        });
      }
      return rows;
    });

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
      if (
        !current ||
        (violation.severity === RiskLevel.CRITICAL &&
          currentSeverity !== RiskLevel.CRITICAL)
      ) {
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
        deviceReading: { select: { id: true, deviceId: true } },
      },
    });
    return { patientId, count: items.length, items };
  }

  // -------------------------------------------------------------------------

  /**
   * Writes one measurement. Device-sourced values also create the raw
   * DeviceReading row the ERD requires, linked 1:1 to the vital sign.
   */
  private async persistReading(
    tx: Prisma.TransactionClient,
    patientId: number,
    dto: RecordVitalDto,
  ): Promise<VitalSign> {
    const measuredAt = dto.measuredAt ? new Date(dto.measuredAt) : new Date();

    const deviceReadingId = dto.deviceId
      ? (
          await tx.deviceReading.create({
            data: {
              deviceId: dto.deviceId,
              type: dto.type,
              value: dto.value,
              unit: dto.unit,
              measuredAt,
            },
            select: { id: true },
          })
        ).id
      : null;

    return tx.vitalSign.create({
      data: {
        patientId,
        type: dto.type,
        value: dto.value,
        unit: dto.unit,
        source: dto.deviceId ? VitalSource.DEVICE : VitalSource.MANUAL,
        deviceReadingId,
        measuredAt,
      },
    });
  }

  private async checkThreshold(vital: VitalSign) {
    const violation = evaluateVital(vital.type, vital.value);
    if (!violation) return;

    const typeLabel = vital.type.toLowerCase().replace(/_/g, ' ');
    await this.alerts.raise({
      patientId: vital.patientId,
      type: AlertType.VITAL_ANOMALY,
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
      select: { patientId: true, status: true },
    });
    if (
      !device ||
      device.patientId !== patientId ||
      device.status !== DeviceStatus.CONNECTED
    ) {
      throw new BadRequestException(
        'deviceId does not belong to you or is not connected.',
      );
    }
  }
}
