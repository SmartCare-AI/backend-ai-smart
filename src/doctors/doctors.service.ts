import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AlertStatus,
  AppointmentStatus,
  MedicineTrackingStatus,
  NotificationType,
  OnlineVisitStatus,
  Prisma,
  ProfileStatus,
  Role,
  UserStatus,
} from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProfilesService } from '../users/profiles.service';
import { UsersService } from '../users/users.service';
import { ConsentService } from '../consent/consent.service';
import {
  AdminListDoctorsDto,
  BecomeDoctorDto,
  MyPatientsQueryDto,
  SearchDoctorsDto,
  SetDoctorStatusDto,
  UpdateMyDoctorProfileDto,
} from './dto/doctor.dtos';
import { SPECIALIZATIONS } from './specializations';

/** What anyone may see about a doctor (no license, no contact data). */
const PUBLIC_DOCTOR_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  specialization: true,
  yearsOfExperience: true,
  bio: true,
  hospital: { select: { id: true, name: true } },
  department: { select: { id: true, name: true } },
  user: { select: { avatarUrl: true } },
} satisfies Prisma.DoctorProfileSelect;

type PublicDoctorRow = Prisma.DoctorProfileGetPayload<{
  select: typeof PUBLIC_DOCTOR_SELECT;
}>;

/**
 * Doctor directory and self-service doctor profile (MVP Phase 1).
 *
 * "Listed" = the doctor can be found and booked: profile ACTIVE, email
 * verified (isVerified) and account ACTIVE.
 */
@Injectable()
export class DoctorsService {
  private readonly logger = new Logger(DoctorsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly profiles: ProfilesService,
    private readonly users: UsersService,
    private readonly notifications: NotificationsService,
    private readonly consent: ConsentService,
  ) {}

  /** Filter shared by search, public profile and booking. */
  static listedWhere(): Prisma.DoctorProfileWhereInput {
    return {
      status: ProfileStatus.ACTIVE,
      isVerified: true,
      user: { status: UserStatus.ACTIVE, isEmailVerified: true },
    };
  }

  specializations() {
    return { items: [...SPECIALIZATIONS] };
  }

  async search(query: SearchDoctorsDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.DoctorProfileWhereInput = {
      ...DoctorsService.listedWhere(),
      ...(query.specialization && {
        specialization: { equals: query.specialization, mode: 'insensitive' },
      }),
      ...(query.hospitalId && { hospitalId: query.hospitalId }),
      ...(query.q && {
        OR: query.q
          .trim()
          .split(/\s+/)
          .map((term) => ({
            OR: [
              { firstName: { contains: term, mode: 'insensitive' as const } },
              { lastName: { contains: term, mode: 'insensitive' as const } },
            ],
          })),
      }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.doctorProfile.findMany({
        where,
        select: PUBLIC_DOCTOR_SELECT,
        orderBy: [
          { yearsOfExperience: { sort: 'desc', nulls: 'last' } },
          { lastName: 'asc' },
        ],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.doctorProfile.count({ where }),
    ]);
    return { items: rows.map(toPublicDoctor), total, page, limit };
  }

  async findPublic(id: number) {
    const row = await this.prisma.doctorProfile.findFirst({
      where: { id, ...DoctorsService.listedWhere() },
      select: PUBLIC_DOCTOR_SELECT,
    });
    if (!row) throw new NotFoundException('Doctor not found.');
    return toPublicDoctor(row);
  }

  async getMine(userId: number) {
    const profile = await this.profiles.getDoctorByUserId(userId);
    return this.prisma.doctorProfile.findUniqueOrThrow({
      where: { id: profile.id },
      include: {
        hospital: { select: { id: true, name: true } },
        department: { select: { id: true, name: true } },
      },
    });
  }

  async updateMine(userId: number, dto: UpdateMyDoctorProfileDto) {
    const profile = await this.profiles.getDoctorByUserId(userId);
    const hospitalId =
      dto.hospitalId !== undefined ? dto.hospitalId : profile.hospitalId;
    const departmentId =
      dto.departmentId !== undefined
        ? dto.departmentId
        : // Moving hospital without naming a department clears the old one.
          dto.hospitalId !== undefined && dto.hospitalId !== profile.hospitalId
          ? null
          : profile.departmentId;
    await this.profiles.assertPlacement(hospitalId, departmentId);

    await this.prisma.doctorProfile.update({
      where: { id: profile.id },
      data: {
        ...(dto.firstName !== undefined && { firstName: dto.firstName }),
        ...(dto.lastName !== undefined && { lastName: dto.lastName }),
        ...(dto.specialization !== undefined && {
          specialization: dto.specialization,
        }),
        ...(dto.yearsOfExperience !== undefined && {
          yearsOfExperience: dto.yearsOfExperience,
        }),
        ...(dto.bio !== undefined && { bio: dto.bio }),
        hospitalId,
        departmentId,
      },
    });
    return this.getMine(userId);
  }

  /**
   * An existing account (typically created by Google/Apple sign-in, which
   * always starts as a patient) adds a doctor profile. The account's active
   * role switches to DOCTOR; its patient profile is kept.
   */
  async becomeDoctor(userId: number, dto: BecomeDoctorDto) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        patientProfile: true,
        caregiverProfile: true,
        doctorProfile: true,
      },
    });
    if (user.doctorProfile) {
      throw new ConflictException('This account already has a doctor profile.');
    }
    if (user.role === Role.ADMIN || user.role === Role.HOSPITAL_ADMIN) {
      throw new BadRequestException(
        'Administrator accounts cannot become doctors.',
      );
    }
    const names = user.patientProfile ?? user.caregiverProfile;
    const firstName = dto.firstName ?? names?.firstName;
    const lastName = dto.lastName ?? names?.lastName;
    if (!firstName || !lastName) {
      throw new BadRequestException('firstName and lastName are required.');
    }
    await this.profiles.assertLicenseAvailable(dto.licenseNumber, userId);
    await this.profiles.assertPlacement(dto.hospitalId, dto.departmentId);

    await this.prisma.$transaction([
      this.prisma.doctorProfile.create({
        data: {
          userId,
          firstName,
          lastName,
          licenseNumber: dto.licenseNumber,
          specialization: dto.specialization,
          yearsOfExperience: dto.yearsOfExperience,
          bio: dto.bio ?? null,
          hospitalId: dto.hospitalId ?? null,
          departmentId: dto.departmentId ?? null,
          // Only verified emails reach this endpoint (login requires it).
          isVerified: user.isEmailVerified,
        },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: { role: Role.DOCTOR },
      }),
    ]);
    return this.users.getProfile(userId);
  }

  /**
   * The doctor's patient list: everyone with an active care relationship,
   * with the numbers a dashboard needs (last visit, open alerts, 30-day
   * medication adherence, next appointment).
   */
  async myPatients(userId: number, query: MyPatientsQueryDto) {
    const doctor = await this.profiles.getDoctorByUserId(userId);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const q = query.q?.trim();
    const where: Prisma.CareRelationshipWhereInput = {
      doctorId: doctor.id,
      ...this.consent.activeRelationshipWhere(),
      ...(q && {
        patient: {
          OR: [
            { firstName: { contains: q, mode: 'insensitive' } },
            { lastName: { contains: q, mode: 'insensitive' } },
            { medicalRecordNo: { contains: q, mode: 'insensitive' } },
          ],
        },
      }),
    };
    const [relationships, total] = await this.prisma.$transaction([
      this.prisma.careRelationship.findMany({
        where,
        include: {
          patient: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              medicalRecordNo: true,
              dateOfBirth: true,
              gender: true,
              bloodType: true,
              user: { select: { id: true, avatarUrl: true } },
              _count: {
                select: {
                  alerts: {
                    where: {
                      status: {
                        in: [AlertStatus.NEW, AlertStatus.ACKNOWLEDGED],
                      },
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.careRelationship.count({ where }),
    ]);

    const patientIds = relationships.map((r) => r.patientId);
    const since = new Date(Date.now() - 30 * 86_400_000);
    const [doses, visits, upcoming] = await Promise.all([
      this.prisma.medicineTracking.groupBy({
        by: ['patientId', 'status'],
        where: {
          patientId: { in: patientIds },
          scheduledTime: { gte: since, lte: new Date() },
          status: {
            in: [MedicineTrackingStatus.TAKEN, MedicineTrackingStatus.MISSED],
          },
        },
        _count: { _all: true },
      }),
      this.prisma.visit.findMany({
        where: {
          appointment: { doctorId: doctor.id, patientId: { in: patientIds } },
        },
        orderBy: { date: 'desc' },
        select: { date: true, appointment: { select: { patientId: true } } },
      }),
      this.prisma.appointment.findMany({
        where: {
          doctorId: doctor.id,
          patientId: { in: patientIds },
          status: {
            in: [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED],
          },
          startTime: { gt: new Date() },
        },
        orderBy: { startTime: 'asc' },
        select: { id: true, patientId: true, startTime: true, status: true },
      }),
    ]);

    const adherence = (patientId: number): number | null => {
      const count = (status: MedicineTrackingStatus) =>
        doses.find((d) => d.patientId === patientId && d.status === status)
          ?._count._all ?? 0;
      const taken = count(MedicineTrackingStatus.TAKEN);
      const settled = taken + count(MedicineTrackingStatus.MISSED);
      return settled === 0 ? null : Math.round((taken / settled) * 100) / 100;
    };

    return {
      items: relationships.map((r) => {
        const { user, _count, ...patient } = r.patient;
        return {
          relationshipId: r.id,
          accessExpiresAt: r.expiresAt,
          patient: { ...patient, userId: user.id, avatarUrl: user.avatarUrl },
          openAlerts: _count.alerts,
          adherenceScore30d: adherence(r.patientId),
          lastVisitAt:
            visits.find((v) => v.appointment.patientId === r.patientId)?.date ??
            null,
          nextAppointment:
            upcoming.find((a) => a.patientId === r.patientId) ?? null,
        };
      }),
      total,
      page,
      limit,
    };
  }

  // -------------------------------------------------------------------------
  // Admin
  // -------------------------------------------------------------------------

  async adminList(query: AdminListDoctorsDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const q = query.q?.trim();
    const where: Prisma.DoctorProfileWhereInput = {
      ...(query.status && { status: query.status }),
      ...(q && {
        OR: [
          { firstName: { contains: q, mode: 'insensitive' } },
          { lastName: { contains: q, mode: 'insensitive' } },
          { licenseNumber: { contains: q, mode: 'insensitive' } },
          { user: { email: { contains: q, mode: 'insensitive' } } },
        ],
      }),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.doctorProfile.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              isEmailVerified: true,
              createdAt: true,
            },
          },
          hospital: { select: { id: true, name: true } },
        },
        orderBy: { id: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.doctorProfile.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  /**
   * Suspend or reactivate a doctor. Suspension is the MVP safety valve for
   * self-registration: the doctor disappears from search, loses record
   * access (ConsentService checks the profile status), and every future
   * appointment is cancelled with the patient notified.
   */
  async setStatus(doctorId: number, dto: SetDoctorStatusDto) {
    const doctor = await this.prisma.doctorProfile.findUnique({
      where: { id: doctorId },
    });
    if (!doctor) throw new NotFoundException('Doctor not found.');
    if (doctor.status === dto.status) {
      throw new BadRequestException(`Doctor is already ${dto.status}.`);
    }

    await this.prisma.doctorProfile.update({
      where: { id: doctorId },
      data: { status: dto.status },
    });

    let cancelledAppointments = 0;
    if (dto.status === ProfileStatus.SUSPENDED) {
      cancelledAppointments = await this.cancelFutureAppointments(doctorId);
      await this.notifications.notify(doctor.userId, {
        type: NotificationType.SYSTEM,
        title: 'Doctor account suspended',
        message: dto.reason
          ? `Your doctor profile was suspended: ${dto.reason}`
          : 'Your doctor profile was suspended. Contact support for details.',
        data: { screen: 'profile' },
      });
    } else {
      await this.notifications.notify(doctor.userId, {
        type: NotificationType.SYSTEM,
        title: 'Doctor account reactivated',
        message: 'Your doctor profile is active again and visible to patients.',
        data: { screen: 'profile' },
      });
    }
    this.logger.warn(
      `Doctor ${doctorId} → ${dto.status}${dto.reason ? ` (${dto.reason})` : ''}; ${cancelledAppointments} appointment(s) cancelled.`,
    );
    return {
      id: doctorId,
      status: dto.status,
      cancelledAppointments,
    };
  }

  private async cancelFutureAppointments(doctorId: number): Promise<number> {
    const upcoming = await this.prisma.appointment.findMany({
      where: {
        doctorId,
        status: {
          in: [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED],
        },
        startTime: { gt: new Date() },
      },
      select: {
        id: true,
        startTime: true,
        patient: { select: { userId: true } },
      },
    });
    if (upcoming.length === 0) return 0;
    const ids = upcoming.map((a) => a.id);
    await this.prisma.$transaction([
      this.prisma.appointment.updateMany({
        where: { id: { in: ids } },
        data: {
          status: AppointmentStatus.CANCELLED,
          notes: 'Cancelled: the doctor is no longer available.',
        },
      }),
      this.prisma.onlineVisit.updateMany({
        where: {
          appointmentId: { in: ids },
          status: { not: OnlineVisitStatus.COMPLETED },
        },
        data: { status: OnlineVisitStatus.CANCELLED },
      }),
    ]);
    for (const appointment of upcoming) {
      await this.notifications.notify(appointment.patient.userId, {
        type: NotificationType.APPOINTMENT,
        title: 'Appointment cancelled',
        message: `Your appointment on ${appointment.startTime.toISOString()} was cancelled because the doctor is no longer available. Please book another doctor.`,
        data: { screen: 'appointments', id: String(appointment.id) },
      });
    }
    return upcoming.length;
  }
}

function toPublicDoctor(row: PublicDoctorRow) {
  const { user, ...doctor } = row;
  return { ...doctor, avatarUrl: user.avatarUrl };
}
