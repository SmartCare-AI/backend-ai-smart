import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AlertType,
  ConsentType,
  DeviceStatus,
  Prisma,
  RiskLevel,
  VitalSource,
} from '@prisma/client';
import { AlertsService } from '../alerts/alerts.service';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ConsentService } from '../consent/consent.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProfilesService } from '../users/profiles.service';
import { evaluateVital } from '../vitals/vital-thresholds';
import {
  ListReadingsDto,
  RegisterDeviceDto,
  SyncReadingsDto,
  UpdateDeviceDto,
} from './dto/device.dtos';

/**
 * ERD #22 Device and #23 DeviceReading (FR-021/FR-022).
 *
 * BR-009: readings belong to a Device and inherit patient context through it,
 * so nothing here stores a patientId on the reading. A sync optionally
 * promotes each raw reading into the clinical VitalSign stream, which is what
 * thresholds, charts and the AI modules read.
 */
@Injectable()
export class DevicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly consent: ConsentService,
    private readonly profiles: ProfilesService,
    private readonly alerts: AlertsService,
  ) {}

  // -------------------------------------------------------------------------
  // Devices
  // -------------------------------------------------------------------------

  async register(requester: AuthenticatedUser, dto: RegisterDeviceDto) {
    const patient = await this.profiles.getPatientByUserId(requester.id);
    if (dto.serialNumber) {
      const existing = await this.prisma.device.findUnique({
        where: { serialNumber: dto.serialNumber },
        select: { id: true, patientId: true },
      });
      if (existing && existing.patientId !== patient.id) {
        throw new ConflictException(
          'This device is already paired with another patient.',
        );
      }
      if (existing) {
        // Re-pairing the same hardware reconnects it instead of duplicating.
        return this.prisma.device.update({
          where: { id: existing.id },
          data: {
            ...dto,
            status: DeviceStatus.CONNECTED,
            connectedDate: new Date(),
          },
        });
      }
    }
    return this.prisma.device.create({
      data: { patientId: patient.id, ...dto },
    });
  }

  async listMine(requester: AuthenticatedUser) {
    const patient = await this.profiles.getPatientByUserId(requester.id);
    return this.prisma.device.findMany({
      where: { patientId: patient.id },
      orderBy: [{ status: 'asc' }, { connectedDate: 'desc' }],
    });
  }

  /** A patient's devices, for the doctor/caregiver monitoring view. */
  async listForPatient(requester: AuthenticatedUser, patientId: number) {
    await this.consent.assertCanAccessPatient(
      requester,
      patientId,
      ConsentType.VIEW_RECORDS,
    );
    return this.prisma.device.findMany({
      where: { patientId },
      orderBy: [{ status: 'asc' }, { connectedDate: 'desc' }],
    });
  }

  async update(
    requester: AuthenticatedUser,
    deviceId: number,
    dto: UpdateDeviceDto,
  ) {
    const device = await this.getOwnedDevice(requester, deviceId);
    return this.prisma.device.update({ where: { id: device.id }, data: dto });
  }

  /** Unpair — the device and its readings stay for the clinical history. */
  async disconnect(requester: AuthenticatedUser, deviceId: number) {
    const device = await this.getOwnedDevice(requester, deviceId);
    return this.prisma.device.update({
      where: { id: device.id },
      data: { status: DeviceStatus.DISCONNECTED },
    });
  }

  // -------------------------------------------------------------------------
  // Readings
  // -------------------------------------------------------------------------

  /**
   * Bulk ingest from a wearable. Stores the raw DeviceReading rows and — by
   * default — mirrors each into VitalSign so thresholds can fire. At most one
   * alert per vital type per sync (worst reading wins).
   */
  async sync(
    requester: AuthenticatedUser,
    deviceId: number,
    dto: SyncReadingsDto,
  ) {
    const device = await this.getOwnedDevice(requester, deviceId);
    if (device.status === DeviceStatus.INACTIVE) {
      throw new BadRequestException('This device is inactive.');
    }
    const promote = dto.promoteToVitals !== false;

    const vitals = await this.prisma.$transaction(async (tx) => {
      const promoted: {
        id: number;
        type: string;
        value: number;
        unit: string;
        patientId: number;
      }[] = [];

      for (const reading of dto.readings) {
        const measuredAt = reading.measuredAt
          ? new Date(reading.measuredAt)
          : new Date();
        const raw = await tx.deviceReading.create({
          data: {
            deviceId: device.id,
            type: reading.type,
            value: reading.value,
            unit: reading.unit ?? null,
            measuredAt,
          },
        });
        if (!promote) continue;

        const vital = await tx.vitalSign.create({
          data: {
            patientId: device.patientId,
            type: reading.type,
            value: reading.value,
            unit: reading.unit ?? '',
            source: VitalSource.DEVICE,
            deviceReadingId: raw.id,
            measuredAt,
          },
        });
        promoted.push({
          id: vital.id,
          type: vital.type,
          value: vital.value,
          unit: vital.unit,
          patientId: vital.patientId,
        });
      }

      await tx.device.update({
        where: { id: device.id },
        data: { lastSync: new Date(), status: DeviceStatus.CONNECTED },
      });
      return promoted;
    });

    await this.raiseWorstPerType(vitals);
    return {
      deviceId: device.id,
      received: dto.readings.length,
      promotedToVitals: vitals.length,
    };
  }

  async listReadings(
    requester: AuthenticatedUser,
    deviceId: number,
    query: ListReadingsDto,
  ) {
    const device = await this.prisma.device.findUnique({
      where: { id: deviceId },
      select: { id: true, patientId: true },
    });
    if (!device) throw new NotFoundException('Device not found.');
    // BR-009: the reading's patient context comes from the device.
    await this.consent.assertCanAccessPatient(
      requester,
      device.patientId,
      ConsentType.VIEW_RECORDS,
    );

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.DeviceReadingWhereInput = {
      deviceId: device.id,
      ...(query.type ? { type: query.type } : {}),
      ...(query.from || query.to
        ? {
            measuredAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.deviceReading.findMany({
        where,
        orderBy: { measuredAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.deviceReading.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  // -------------------------------------------------------------------------

  private async raiseWorstPerType(
    vitals: {
      id: number;
      type: string;
      value: number;
      unit: string;
      patientId: number;
    }[],
  ) {
    const worst = new Map<string, (typeof vitals)[number]>();
    for (const vital of vitals) {
      const violation = evaluateVital(
        vital.type as Parameters<typeof evaluateVital>[0],
        vital.value,
      );
      if (!violation) continue;
      const current = worst.get(vital.type);
      const currentSeverity = current
        ? evaluateVital(
            current.type as Parameters<typeof evaluateVital>[0],
            current.value,
          )?.severity
        : undefined;
      if (
        !current ||
        (violation.severity === RiskLevel.CRITICAL &&
          currentSeverity !== RiskLevel.CRITICAL)
      ) {
        worst.set(vital.type, vital);
      }
    }

    for (const vital of worst.values()) {
      const violation = evaluateVital(
        vital.type as Parameters<typeof evaluateVital>[0],
        vital.value,
      );
      if (!violation) continue;
      const label = vital.type.toLowerCase().replace(/_/g, ' ');
      await this.alerts.raise({
        patientId: vital.patientId,
        type: AlertType.VITAL_ANOMALY,
        title: `Abnormal ${label}: ${vital.value} ${vital.unit}`.trim(),
        description: `Device reading of ${vital.value} ${vital.unit} for ${label} is ${violation.bound} the safe range.`,
        severity: violation.severity,
        source: `vital_threshold:${vital.type}`,
        vitalSignId: vital.id,
      });
    }
  }

  private async getOwnedDevice(
    requester: AuthenticatedUser,
    deviceId: number,
  ) {
    const patient = await this.profiles.getPatientByUserId(requester.id);
    const device = await this.prisma.device.findUnique({
      where: { id: deviceId },
    });
    if (!device) throw new NotFoundException('Device not found.');
    if (device.patientId !== patient.id) {
      throw new ForbiddenException('This device is not yours.');
    }
    return device;
  }
}
