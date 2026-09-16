import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AppointmentStatus,
  AppointmentType,
  AssessmentType,
  ConsentType,
  ImageStatus,
  Prisma,
  Role,
  TestStatus,
  VisitStatus,
  VisitType,
} from '@prisma/client';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ConsentService } from '../consent/consent.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProfilesService } from '../users/profiles.service';
import {
  CloseVisitDto,
  CreateAssessmentDto,
  CreateDiagnosisDto,
  CreateMedicalImageDto,
  CreateMedicalTestDto,
  CreateTestResultDto,
  CreateVisitDto,
  UpdateDiagnosisStatusDto,
} from './dto/visit.dtos';

/** How an appointment type maps onto the encounter classification. */
const VISIT_TYPE_BY_APPOINTMENT: Record<AppointmentType, VisitType> = {
  [AppointmentType.IN_PERSON]: VisitType.IN_PERSON,
  [AppointmentType.VIDEO]: VisitType.ONLINE,
  [AppointmentType.CHAT]: VisitType.ONLINE,
};

@Injectable()
export class VisitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly consent: ConsentService,
    private readonly profiles: ProfilesService,
  ) {}

  // -------------------------------------------------------------------------
  // Visits
  // -------------------------------------------------------------------------

  /**
   * Opens the clinical encounter for an appointment and completes that
   * appointment. BR-004 makes the appointment link mandatory, so patient and
   * doctor context is read through it rather than stored twice.
   */
  async create(requester: AuthenticatedUser, dto: CreateVisitDto) {
    const doctor = await this.profiles.getDoctorByUserId(requester.id);

    const appointment = await this.prisma.appointment.findUnique({
      where: { id: dto.appointmentId },
      include: { visit: { select: { id: true } } },
    });
    if (!appointment) throw new NotFoundException('Appointment not found.');
    if (appointment.doctorId !== doctor.id) {
      throw new ForbiddenException(
        'This appointment belongs to another doctor.',
      );
    }
    if (appointment.status === AppointmentStatus.CANCELLED) {
      throw new BadRequestException(
        'Cannot start a visit from a cancelled appointment.',
      );
    }
    if (appointment.visit) {
      throw new BadRequestException(
        'A visit already exists for this appointment.',
      );
    }

    const [visit] = await this.prisma.$transaction([
      this.prisma.visit.create({
        data: {
          appointmentId: appointment.id,
          type: dto.type ?? VISIT_TYPE_BY_APPOINTMENT[appointment.type],
          mainComplaint: dto.mainComplaint ?? appointment.reason,
          notes: dto.notes,
        },
      }),
      this.prisma.appointment.update({
        where: { id: appointment.id },
        data: { status: AppointmentStatus.COMPLETED },
      }),
    ]);
    return visit;
  }

  async listMine(requester: AuthenticatedUser, page: number, limit: number) {
    let where: Prisma.VisitWhereInput;
    if (requester.role === Role.DOCTOR) {
      const doctor = await this.profiles.getDoctorByUserId(requester.id);
      where = { appointment: { doctorId: doctor.id } };
    } else {
      const patient = await this.profiles.getPatientByUserId(requester.id);
      where = { appointment: { patientId: patient.id } };
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.visit.findMany({
        where,
        include: {
          appointment: {
            select: {
              id: true,
              type: true,
              startTime: true,
              patient: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  medicalRecordNo: true,
                },
              },
              doctor: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  specialization: true,
                },
              },
            },
          },
        },
        orderBy: { date: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.visit.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  /** Full visit record — the "unified patient record" view for one encounter. */
  async findOne(requester: AuthenticatedUser, id: number) {
    const visit = await this.prisma.visit.findUnique({
      where: { id },
      include: {
        appointment: {
          select: {
            id: true,
            type: true,
            startTime: true,
            patientId: true,
            patient: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                medicalRecordNo: true,
              },
            },
            doctor: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                specialization: true,
              },
            },
            onlineVisit: true,
          },
        },
        assessments: { orderBy: { date: 'desc' } },
        diagnoses: { include: { treatmentPlans: true } },
        medicalTests: { include: { result: { include: { file: true } } } },
        medicalImages: { include: { file: true } },
      },
    });
    if (!visit) throw new NotFoundException('Visit not found.');
    await this.consent.assertCanAccessPatient(
      requester,
      visit.appointment.patientId,
      ConsentType.VIEW_RECORDS,
    );
    return visit;
  }

  async close(requester: AuthenticatedUser, id: number, dto: CloseVisitDto) {
    const visit = await this.getOwnedVisit(requester, id);
    if (visit.status !== VisitStatus.OPEN) {
      throw new BadRequestException('Visit is already closed.');
    }
    return this.prisma.visit.update({
      where: { id },
      data: {
        status: dto.followUpRequired
          ? VisitStatus.FOLLOW_UP_REQUIRED
          : VisitStatus.CLOSED,
        notes: dto.notes ?? visit.notes,
      },
    });
  }

  // -------------------------------------------------------------------------
  // Nested clinical records (treating doctor only, on an open visit)
  // -------------------------------------------------------------------------

  async addDiagnosis(
    requester: AuthenticatedUser,
    visitId: number,
    dto: CreateDiagnosisDto,
  ) {
    const visit = await this.getOwnedVisit(requester, visitId, true);
    return this.prisma.diagnosis.create({
      data: { visitId: visit.id, ...dto },
    });
  }

  async updateDiagnosisStatus(
    requester: AuthenticatedUser,
    diagnosisId: number,
    dto: UpdateDiagnosisStatusDto,
  ) {
    const diagnosis = await this.prisma.diagnosis.findUnique({
      where: { id: diagnosisId },
      select: { id: true, visitId: true },
    });
    if (!diagnosis) throw new NotFoundException('Diagnosis not found.');
    await this.getOwnedVisit(requester, diagnosis.visitId);
    return this.prisma.diagnosis.update({
      where: { id: diagnosisId },
      data: { status: dto.status },
    });
  }

  async addTest(
    requester: AuthenticatedUser,
    visitId: number,
    dto: CreateMedicalTestDto,
  ) {
    const visit = await this.getOwnedVisit(requester, visitId, true);
    return this.prisma.medicalTest.create({
      data: { visitId: visit.id, doctorId: visit.appointment.doctorId, ...dto },
    });
  }

  async addTestResult(
    requester: AuthenticatedUser,
    testId: number,
    dto: CreateTestResultDto,
  ) {
    const test = await this.prisma.medicalTest.findUnique({
      where: { id: testId },
      include: {
        visit: { select: { appointment: { select: { doctorId: true } } } },
        result: true,
      },
    });
    if (!test) throw new NotFoundException('Test not found.');
    const doctor = await this.profiles.getDoctorByUserId(requester.id);
    if (test.visit.appointment.doctorId !== doctor.id) {
      throw new ForbiddenException('This test belongs to another doctor.');
    }
    if (test.result) {
      throw new BadRequestException('This test already has a result.');
    }
    if (dto.fileId) await this.assertFileExists(dto.fileId);

    const [result] = await this.prisma.$transaction([
      this.prisma.testResult.create({ data: { testId, ...dto } }),
      this.prisma.medicalTest.update({
        where: { id: testId },
        data: { status: TestStatus.COMPLETED },
      }),
    ]);
    return result;
  }

  async addImage(
    requester: AuthenticatedUser,
    visitId: number,
    dto: CreateMedicalImageDto,
  ) {
    const visit = await this.getOwnedVisit(requester, visitId, true);
    await this.assertFileExists(dto.fileId);
    return this.prisma.medicalImage.create({
      data: {
        visitId: visit.id,
        doctorId: visit.appointment.doctorId,
        status: dto.report ? ImageStatus.REVIEWED : ImageStatus.AVAILABLE,
        ...dto,
      },
    });
  }

  // -------------------------------------------------------------------------
  // Assessments (patient self-report / doctor evaluation)
  // -------------------------------------------------------------------------

  async createAssessment(
    requester: AuthenticatedUser,
    dto: CreateAssessmentDto,
  ) {
    if (requester.role === Role.PATIENT) {
      // Patients only self-report; type is forced, visit attachment ignored.
      const patient = await this.profiles.getPatientByUserId(requester.id);
      return this.prisma.assessment.create({
        data: {
          patientId: patient.id,
          type: AssessmentType.AI_INITIAL,
          symptoms: dto.symptoms,
          observations: dto.observations,
          notes: dto.notes,
        },
      });
    }

    // Doctors (and admins) must name the patient.
    if (!dto.patientId) {
      throw new BadRequestException('patientId is required.');
    }
    await this.consent.assertCanAccessPatient(
      requester,
      dto.patientId,
      ConsentType.VIEW_RECORDS,
    );
    // A visit-attached assessment must belong to the same patient.
    if (dto.visitId) {
      const visit = await this.prisma.visit.findUnique({
        where: { id: dto.visitId },
        select: { appointment: { select: { patientId: true } } },
      });
      if (!visit) throw new NotFoundException('Visit not found.');
      if (visit.appointment.patientId !== dto.patientId) {
        throw new BadRequestException(
          'visitId does not belong to this patient.',
        );
      }
    }

    return this.prisma.assessment.create({
      data: {
        patientId: dto.patientId,
        visitId: dto.visitId ?? null,
        type: dto.type ?? AssessmentType.DOCTOR,
        symptoms: dto.symptoms,
        observations: dto.observations,
        riskLevel: dto.riskLevel,
        suggestedSpecialty: dto.suggestedSpecialty,
        notes: dto.notes,
      },
    });
  }

  async listAssessments(
    requester: AuthenticatedUser,
    patientId: number,
    page: number,
    limit: number,
  ) {
    await this.consent.assertCanAccessPatient(
      requester,
      patientId,
      ConsentType.VIEW_RECORDS,
    );
    const where = { patientId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.assessment.findMany({
        where,
        orderBy: { date: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.assessment.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  // -------------------------------------------------------------------------

  /** Loads the visit and verifies the requester is its treating doctor. */
  private async getOwnedVisit(
    requester: AuthenticatedUser,
    visitId: number,
    mustBeOpen = false,
  ) {
    const visit = await this.prisma.visit.findUnique({
      where: { id: visitId },
      include: {
        appointment: { select: { doctorId: true, patientId: true } },
      },
    });
    if (!visit) throw new NotFoundException('Visit not found.');
    const doctor = await this.profiles.getDoctorByUserId(requester.id);
    if (visit.appointment.doctorId !== doctor.id) {
      throw new ForbiddenException('This visit belongs to another doctor.');
    }
    if (mustBeOpen && visit.status !== VisitStatus.OPEN) {
      throw new BadRequestException(
        'This visit is closed — reopen is not supported.',
      );
    }
    return visit;
  }

  private async assertFileExists(fileId: number) {
    const file = await this.prisma.fileObject.findUnique({
      where: { id: fileId },
      select: { id: true },
    });
    if (!file) throw new BadRequestException(`File ${fileId} does not exist.`);
  }
}
