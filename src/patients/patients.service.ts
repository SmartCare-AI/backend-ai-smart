import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AppointmentStatus,
  CareRelationshipStatus,
  NotificationType,
  Role,
} from '@prisma/client';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';
import { displayName, fullName } from '../common/utils/user-name.util';
import { ACCESS_AUDIT, ConsentService } from '../consent/consent.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProfilesService } from '../users/profiles.service';

const UPCOMING: AppointmentStatus[] = [
  AppointmentStatus.PENDING,
  AppointmentStatus.CONFIRMED,
];

/**
 * The patient's view of who can see their record (MVP Phase 3):
 * their care team (doctors with access), the ability to remove a doctor,
 * and the access history from the audit log.
 */
@Injectable()
export class PatientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly consent: ConsentService,
    private readonly profiles: ProfilesService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Doctors who can currently read my record, and until when. */
  async careTeam(requester: AuthenticatedUser) {
    const patient = await this.profiles.getPatientByUserId(requester.id);
    const relationships = await this.prisma.careRelationship.findMany({
      where: {
        patientId: patient.id,
        ...this.consent.activeRelationshipWhere(),
      },
      include: {
        doctor: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            specialization: true,
            user: { select: { id: true, avatarUrl: true } },
            hospital: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { startsAt: 'asc' },
    });
    const doctorIds = relationships.map((r) => r.doctorId);
    const [upcoming, visits] = await Promise.all([
      this.prisma.appointment.findMany({
        where: {
          patientId: patient.id,
          doctorId: { in: doctorIds },
          status: { in: UPCOMING },
          startTime: { gt: new Date() },
        },
        orderBy: { startTime: 'asc' },
        select: { id: true, doctorId: true, startTime: true, status: true },
      }),
      this.prisma.visit.findMany({
        where: {
          appointment: { patientId: patient.id, doctorId: { in: doctorIds } },
        },
        orderBy: { date: 'desc' },
        select: { date: true, appointment: { select: { doctorId: true } } },
      }),
    ]);
    return {
      items: relationships.map((r) => {
        const { user, ...doctor } = r.doctor;
        return {
          id: r.id,
          since: r.startsAt,
          expiresAt: r.expiresAt,
          doctor: { ...doctor, userId: user.id, avatarUrl: user.avatarUrl },
          lastVisitAt:
            visits.find((v) => v.appointment.doctorId === r.doctorId)?.date ??
            null,
          nextAppointment:
            upcoming.find((a) => a.doctorId === r.doctorId) ?? null,
        };
      }),
    };
  }

  /**
   * Removes a doctor's access to my record. Blocked while an appointment
   * with them is still upcoming — cancel that first (otherwise confirming
   * it would silently grant access again).
   */
  async revokeCare(requester: AuthenticatedUser, relationshipId: number) {
    const patient = await this.profiles.getPatientByUserId(requester.id);
    const relationship = await this.prisma.careRelationship.findFirst({
      where: {
        id: relationshipId,
        patientId: patient.id,
        status: CareRelationshipStatus.ACTIVE,
      },
      include: { doctor: { select: { userId: true } } },
    });
    if (!relationship)
      throw new NotFoundException('Care team member not found.');

    const upcoming = await this.prisma.appointment.findFirst({
      where: {
        patientId: patient.id,
        doctorId: relationship.doctorId,
        status: { in: UPCOMING },
        startTime: { gt: new Date() },
      },
      select: { id: true },
    });
    if (upcoming) {
      throw new ConflictException(
        'You have an upcoming appointment with this doctor. Cancel it first.',
      );
    }

    const updated = await this.prisma.careRelationship.update({
      where: { id: relationship.id },
      data: {
        status: CareRelationshipStatus.REVOKED,
        revokedAt: new Date(),
      },
    });
    await this.notifications.notify(relationship.doctor.userId, {
      type: NotificationType.SYSTEM,
      title: 'Record access removed',
      message: `${fullName(patient)} removed your access to their medical record.`,
      data: { screen: 'patients' },
    });
    return {
      id: updated.id,
      status: updated.status,
      revokedAt: updated.revokedAt,
    };
  }

  /** Who opened (or tried to open) my record, newest first. */
  async accessHistory(requester: AuthenticatedUser, query: PaginationDto) {
    const patient = await this.profiles.getPatientByUserId(requester.id);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = {
      entityName: ACCESS_AUDIT.ENTITY,
      entityId: String(patient.id),
      action: { in: [ACCESS_AUDIT.ALLOWED, ACCESS_AUDIT.DENIED] },
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              patientProfile: { select: { firstName: true, lastName: true } },
              doctorProfile: { select: { firstName: true, lastName: true } },
              caregiverProfile: { select: { firstName: true, lastName: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return {
      items: rows.map((row) => {
        // description = "<ROLE>:<PERMISSION>" (see ConsentService.logAccess)
        const [role, permission] = (row.description ?? ':').split(':');
        const user = row.user;
        const roleProfile =
          role === Role.DOCTOR
            ? user?.doctorProfile
            : role === Role.CAREGIVER
              ? user?.caregiverProfile
              : null;
        return {
          id: row.id,
          at: row.createdAt,
          outcome: row.action === ACCESS_AUDIT.ALLOWED ? 'ALLOWED' : 'DENIED',
          role,
          permission,
          actor: user
            ? {
                userId: user.id,
                name: roleProfile ? fullName(roleProfile) : displayName(user),
              }
            : null,
        };
      }),
      total,
      page,
      limit,
    };
  }
}
