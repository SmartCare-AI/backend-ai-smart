import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AlertStatus,
  CareLinkStatus,
  ConsentStatus,
  ConsentType,
  InvitationStatus,
  NotificationType,
  Prisma,
  Role,
} from '@prisma/client';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { fullName } from '../common/utils/user-name.util';
import { ConsentService } from '../consent/consent.service';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProfilesService } from '../users/profiles.service';
import { UsersService } from '../users/users.service';
import {
  GrantConsentDto,
  InviteCaregiverDto,
  UpdateCaregiverLinkDto,
} from './dto/caregiver.dtos';

const INVITATION_TTL_DAYS = 7;

const CAREGIVER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  relationship: true,
  user: {
    select: { id: true, email: true, phone: true, avatarUrl: true },
  },
} satisfies Prisma.CaregiverProfileSelect;

/**
 * Family Portal (MVP Phase 2, BRD FR-006/FR-007, SEC-003).
 *
 * Flow: the patient invites by email → the invitee signs in with that email
 * and accepts → a CaregiverProfile (if new) and an ACTIVE PatientCaregiver
 * link are created. The patient controls the permission level, an optional
 * end date, extra consents, and can revoke at any time. No admin involved.
 */
@Injectable()
export class CaregiversService {
  private readonly logger = new Logger(CaregiversService.name);
  private readonly maxCompanions: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly consent: ConsentService,
    private readonly profiles: ProfilesService,
    private readonly users: UsersService,
    private readonly notifications: NotificationsService,
    private readonly mail: MailService,
    config: ConfigService,
  ) {
    // BRD §4.4: "add two companions or family members".
    this.maxCompanions = Number(config.get('CAREGIVER_MAX_LINKS') ?? 2);
  }

  // -------------------------------------------------------------------------
  // Patient side
  // -------------------------------------------------------------------------

  async invite(requester: AuthenticatedUser, dto: InviteCaregiverDto) {
    const patient = await this.profiles.getPatientByUserId(requester.id);
    const email = dto.email.toLowerCase();
    if (email === requester.email.toLowerCase()) {
      throw new BadRequestException('You cannot invite yourself.');
    }
    const endDate = dto.endDate ? new Date(dto.endDate) : null;
    if (endDate && endDate <= new Date()) {
      throw new BadRequestException('endDate must be in the future.');
    }

    const [alreadyLinked, alreadyInvited] = await Promise.all([
      this.prisma.patientCaregiver.findFirst({
        where: {
          patientId: patient.id,
          caregiver: { user: { email } },
          ...this.consent.activeCaregiverLinkWhere(),
        },
        select: { id: true },
      }),
      this.prisma.caregiverInvitation.findFirst({
        where: { patientId: patient.id, email, ...this.pendingWhere() },
        select: { id: true },
      }),
    ]);
    if (alreadyLinked) {
      throw new ConflictException(
        'This person is already in your care circle.',
      );
    }
    if (alreadyInvited) {
      throw new ConflictException(
        'This person already has a pending invitation. Cancel it to send a new one.',
      );
    }
    await this.assertRoomInCircle(patient.id);

    const invitation = await this.prisma.caregiverInvitation.create({
      data: {
        patientId: patient.id,
        email,
        relationship: dto.relationship,
        permissionLevel: dto.permissionLevel ?? ConsentType.RECEIVE_ALERTS,
        accessEndDate: endDate,
        expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 86_400_000),
      },
    });

    const patientName = fullName(patient);
    // The invitation lives in the app; a failed email must not undo it.
    await this.mail
      .sendCaregiverInvitation(
        email,
        patientName,
        dto.relationship,
        invitation.expiresAt,
      )
      .catch((err: Error) =>
        this.logger.warn(`Invitation email to ${email} failed: ${err.message}`),
      );
    const invitee = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (invitee) {
      await this.notifications.notify(invitee.id, {
        type: NotificationType.SYSTEM,
        title: 'Care circle invitation',
        message: `${patientName} invited you to follow their health as their ${dto.relationship}.`,
        data: { screen: 'invitations', id: String(invitation.id) },
      });
    }
    return invitation;
  }

  /** The patient's care circle: active links + pending invitations. */
  async myCircle(requester: AuthenticatedUser) {
    const patient = await this.profiles.getPatientByUserId(requester.id);
    const [links, invitations] = await Promise.all([
      this.prisma.patientCaregiver.findMany({
        where: {
          patientId: patient.id,
          ...this.consent.activeCaregiverLinkWhere(),
        },
        include: { caregiver: { select: CAREGIVER_SELECT } },
        orderBy: { startDate: 'asc' },
      }),
      this.prisma.caregiverInvitation.findMany({
        where: { patientId: patient.id, ...this.pendingWhere() },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return {
      maxCompanions: this.maxCompanions,
      caregivers: links,
      pendingInvitations: invitations,
    };
  }

  async updateLink(
    requester: AuthenticatedUser,
    linkId: number,
    dto: UpdateCaregiverLinkDto,
  ) {
    const patient = await this.profiles.getPatientByUserId(requester.id);
    const link = await this.prisma.patientCaregiver.findFirst({
      where: {
        id: linkId,
        patientId: patient.id,
        ...this.consent.activeCaregiverLinkWhere(),
      },
      include: { caregiver: { select: { userId: true } } },
    });
    if (!link) throw new NotFoundException('Caregiver link not found.');

    let endDate: Date | null | undefined;
    if (dto.endDate === null) endDate = null;
    else if (dto.endDate !== undefined) {
      endDate = new Date(dto.endDate);
      if (endDate <= new Date()) {
        throw new BadRequestException('endDate must be in the future.');
      }
    }

    const updated = await this.prisma.patientCaregiver.update({
      where: { id: link.id },
      data: {
        ...(dto.permissionLevel && { permissionLevel: dto.permissionLevel }),
        ...(endDate !== undefined && { endDate }),
      },
      include: { caregiver: { select: CAREGIVER_SELECT } },
    });
    await this.notifications.notify(link.caregiver.userId, {
      type: NotificationType.SYSTEM,
      title: 'Your access was updated',
      message: `${fullName(patient)} changed your access to ${updated.permissionLevel.replace(/_/g, ' ').toLowerCase()}.`,
      data: { screen: 'family', id: String(patient.id) },
    });
    return updated;
  }

  /**
   * Ends a link. The patient REVOKES; the caregiver can also LEAVE (ENDED).
   * Extra consents the patient granted to that caregiver are revoked too —
   * leaving the circle removes every permission.
   */
  async removeLink(requester: AuthenticatedUser, linkId: number) {
    const link = await this.prisma.patientCaregiver.findFirst({
      where: { id: linkId, ...this.consent.activeCaregiverLinkWhere() },
      include: {
        patient: { select: { userId: true, firstName: true, lastName: true } },
        caregiver: {
          select: { userId: true, firstName: true, lastName: true },
        },
      },
    });
    const byPatient = link?.patient.userId === requester.id;
    const byCaregiver = link?.caregiver.userId === requester.id;
    if (!link || (!byPatient && !byCaregiver)) {
      throw new NotFoundException('Caregiver link not found.');
    }

    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.patientCaregiver.update({
        where: { id: link.id },
        data: {
          status: byPatient ? CareLinkStatus.REVOKED : CareLinkStatus.ENDED,
          endDate: now,
        },
      }),
      this.prisma.consent.updateMany({
        where: {
          patientId: link.patientId,
          grantedToUserId: link.caregiver.userId,
          status: ConsentStatus.ACTIVE,
        },
        data: { status: ConsentStatus.REVOKED, revokedAt: now },
      }),
    ]);

    if (byPatient) {
      await this.notifications.notify(link.caregiver.userId, {
        type: NotificationType.SYSTEM,
        title: 'Access removed',
        message: `${fullName(link.patient)} removed you from their care circle.`,
        data: { screen: 'family' },
      });
    } else {
      await this.notifications.notify(link.patient.userId, {
        type: NotificationType.SYSTEM,
        title: 'Caregiver left',
        message: `${fullName(link.caregiver)} left your care circle.`,
        data: { screen: 'care-circle' },
      });
    }
    return { id: link.id, status: byPatient ? 'REVOKED' : 'ENDED' };
  }

  async cancelInvitation(requester: AuthenticatedUser, invitationId: number) {
    const patient = await this.profiles.getPatientByUserId(requester.id);
    const invitation = await this.prisma.caregiverInvitation.findFirst({
      where: { id: invitationId, patientId: patient.id },
    });
    if (!invitation) throw new NotFoundException('Invitation not found.');
    if (invitation.status !== InvitationStatus.PENDING) {
      throw new BadRequestException(
        `Invitation is already ${invitation.status}.`,
      );
    }
    return this.prisma.caregiverInvitation.update({
      where: { id: invitation.id },
      data: { status: InvitationStatus.CANCELLED, respondedAt: new Date() },
    });
  }

  // -------------------------------------------------------------------------
  // Caregiver side
  // -------------------------------------------------------------------------

  /** Patients I follow, with my effective permissions and open alerts. */
  async myPatients(requester: AuthenticatedUser) {
    const caregiver = await this.prisma.caregiverProfile.findUnique({
      where: { userId: requester.id },
      select: { id: true },
    });
    if (!caregiver) {
      throw new ForbiddenException('This action requires a caregiver profile.');
    }
    const links = await this.prisma.patientCaregiver.findMany({
      where: {
        caregiverId: caregiver.id,
        ...this.consent.activeCaregiverLinkWhere(),
      },
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
            consents: {
              where: {
                grantedToUserId: requester.id,
                status: ConsentStatus.ACTIVE,
                OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
              },
              select: { type: true },
            },
            _count: {
              select: {
                alerts: {
                  where: {
                    status: { in: [AlertStatus.NEW, AlertStatus.ACKNOWLEDGED] },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { startDate: 'asc' },
    });
    return {
      items: links.map(({ patient, ...link }) => {
        const { consents, _count, user, ...profile } = patient;
        return {
          linkId: link.id,
          permissionLevel: link.permissionLevel,
          permissions: [
            ...new Set([link.permissionLevel, ...consents.map((c) => c.type)]),
          ],
          startDate: link.startDate,
          endDate: link.endDate,
          openAlerts: _count.alerts,
          patient: { ...profile, userId: user.id, avatarUrl: user.avatarUrl },
        };
      }),
    };
  }

  /** Invitations addressed to my email that I can still accept. */
  async myInvitations(requester: AuthenticatedUser) {
    const items = await this.prisma.caregiverInvitation.findMany({
      where: { email: requester.email.toLowerCase(), ...this.pendingWhere() },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return { items };
  }

  async accept(requester: AuthenticatedUser, invitationId: number) {
    const invitation = await this.getMyPendingInvitation(
      requester,
      invitationId,
    );
    const patient = await this.prisma.patientProfile.findUniqueOrThrow({
      where: { id: invitation.patientId },
      select: { id: true, userId: true, firstName: true, lastName: true },
    });
    if (patient.userId === requester.id) {
      throw new BadRequestException('You cannot join your own care circle.');
    }
    await this.assertRoomInCircle(patient.id, requester.id);

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: requester.id },
      include: {
        patientProfile: true,
        doctorProfile: true,
        caregiverProfile: true,
      },
    });
    const names =
      user.caregiverProfile ?? user.patientProfile ?? user.doctorProfile;
    if (!names) {
      throw new BadRequestException(
        'Administrator accounts cannot join a care circle.',
      );
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const caregiver =
        user.caregiverProfile ??
        (await tx.caregiverProfile.create({
          data: {
            userId: user.id,
            firstName: names.firstName,
            lastName: names.lastName,
            relationship: invitation.relationship,
          },
        }));
      const linkData = {
        permissionLevel: invitation.permissionLevel,
        status: CareLinkStatus.ACTIVE,
        startDate: now,
        endDate: invitation.accessEndDate,
      };
      // A previously revoked/ended pair is reactivated (unique pair).
      await tx.patientCaregiver.upsert({
        where: {
          patientId_caregiverId: {
            patientId: patient.id,
            caregiverId: caregiver.id,
          },
        },
        create: {
          patientId: patient.id,
          caregiverId: caregiver.id,
          ...linkData,
        },
        update: linkData,
      });
      await tx.caregiverInvitation.update({
        where: { id: invitation.id },
        data: {
          status: InvitationStatus.ACCEPTED,
          respondedAt: now,
          acceptedByUserId: user.id,
        },
      });
      // A brand-new account lands in the Family Portal. Doctors keep their
      // active role and switch when they want (POST /auth/switch-role).
      if (user.role === Role.PATIENT) {
        await tx.user.update({
          where: { id: user.id },
          data: { role: Role.CAREGIVER },
        });
      }
    });

    await this.notifications.notify(patient.userId, {
      type: NotificationType.SYSTEM,
      title: 'Invitation accepted',
      message: `${fullName(names)} joined your care circle as your ${invitation.relationship}.`,
      data: { screen: 'care-circle' },
    });
    return this.users.getProfile(user.id);
  }

  async decline(requester: AuthenticatedUser, invitationId: number) {
    const invitation = await this.getMyPendingInvitation(
      requester,
      invitationId,
    );
    const updated = await this.prisma.caregiverInvitation.update({
      where: { id: invitation.id },
      data: { status: InvitationStatus.DECLINED, respondedAt: new Date() },
    });
    const patient = await this.prisma.patientProfile.findUnique({
      where: { id: invitation.patientId },
      select: { userId: true },
    });
    if (patient) {
      await this.notifications.notify(patient.userId, {
        type: NotificationType.SYSTEM,
        title: 'Invitation declined',
        message: `${invitation.email} declined your care circle invitation.`,
        data: { screen: 'care-circle' },
      });
    }
    return updated;
  }

  // -------------------------------------------------------------------------
  // Consents — extra permissions on top of a caregiver's link level
  // -------------------------------------------------------------------------

  async grantConsent(requester: AuthenticatedUser, dto: GrantConsentDto) {
    const patient = await this.profiles.getPatientByUserId(requester.id);
    if (
      !(await this.consent.hasActiveCaregiverLink(
        dto.grantedToUserId,
        patient.id,
      ))
    ) {
      throw new BadRequestException(
        'Consents can only be granted to members of your care circle.',
      );
    }
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    if (expiresAt && expiresAt <= new Date()) {
      throw new BadRequestException('expiresAt must be in the future.');
    }
    const existing = await this.prisma.consent.findFirst({
      where: {
        patientId: patient.id,
        grantedToUserId: dto.grantedToUserId,
        type: dto.type,
        status: ConsentStatus.ACTIVE,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(
        'An active consent of this type already exists.',
      );
    }
    const consent = await this.prisma.consent.create({
      data: {
        patientId: patient.id,
        grantedToUserId: dto.grantedToUserId,
        type: dto.type,
        expiresAt,
      },
    });
    await this.notifications.notify(dto.grantedToUserId, {
      type: NotificationType.SYSTEM,
      title: 'New permission',
      message: `${fullName(patient)} granted you ${dto.type.replace(/_/g, ' ').toLowerCase()}.`,
      data: { screen: 'family', id: String(patient.id) },
    });
    return consent;
  }

  async myConsents(requester: AuthenticatedUser) {
    const patient = await this.profiles.getPatientByUserId(requester.id);
    const rows = await this.prisma.consent.findMany({
      where: { patientId: patient.id },
      include: {
        grantedTo: {
          select: {
            id: true,
            email: true,
            caregiverProfile: { select: { firstName: true, lastName: true } },
          },
        },
      },
      orderBy: { grantedAt: 'desc' },
    });
    const now = new Date();
    return {
      items: rows.map((c) => ({
        ...c,
        // Expiry is evaluated on read; the stored status stays ACTIVE.
        status:
          c.status === ConsentStatus.ACTIVE && c.expiresAt && c.expiresAt <= now
            ? ConsentStatus.EXPIRED
            : c.status,
      })),
    };
  }

  async revokeConsent(requester: AuthenticatedUser, consentId: number) {
    const patient = await this.profiles.getPatientByUserId(requester.id);
    const consent = await this.prisma.consent.findFirst({
      where: { id: consentId, patientId: patient.id },
    });
    if (!consent) throw new NotFoundException('Consent not found.');
    if (consent.status !== ConsentStatus.ACTIVE) {
      throw new BadRequestException(`Consent is already ${consent.status}.`);
    }
    return this.prisma.consent.update({
      where: { id: consent.id },
      data: { status: ConsentStatus.REVOKED, revokedAt: new Date() },
    });
  }

  // -------------------------------------------------------------------------

  private pendingWhere(): Prisma.CaregiverInvitationWhereInput {
    return { status: InvitationStatus.PENDING, expiresAt: { gt: new Date() } };
  }

  private async getMyPendingInvitation(
    requester: AuthenticatedUser,
    invitationId: number,
  ) {
    const invitation = await this.prisma.caregiverInvitation.findFirst({
      where: { id: invitationId, email: requester.email.toLowerCase() },
    });
    if (!invitation) throw new NotFoundException('Invitation not found.');
    if (invitation.status !== InvitationStatus.PENDING) {
      throw new BadRequestException(
        `Invitation is already ${invitation.status}.`,
      );
    }
    if (invitation.expiresAt <= new Date()) {
      throw new BadRequestException(
        'This invitation has expired. Ask the patient to invite you again.',
      );
    }
    return invitation;
  }

  /**
   * Companions limit: active links + pending invitations. When accepting,
   * the accepting user's own pending invitation is part of the count, so
   * only other active links are compared.
   */
  private async assertRoomInCircle(
    patientId: number,
    acceptingUserId?: number,
  ): Promise<void> {
    const activeLinks = await this.prisma.patientCaregiver.count({
      where: {
        patientId,
        ...this.consent.activeCaregiverLinkWhere(),
        ...(acceptingUserId && {
          caregiver: { userId: { not: acceptingUserId } },
        }),
      },
    });
    const pending = acceptingUserId
      ? 0
      : await this.prisma.caregiverInvitation.count({
          where: { patientId, ...this.pendingWhere() },
        });
    if (activeLinks + pending >= this.maxCompanions) {
      throw new ConflictException(
        `A care circle can have at most ${this.maxCompanions} companions (including pending invitations).`,
      );
    }
  }
}
