import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AppointmentStatus,
  AssessmentType,
  ConsentType,
  Role,
  VisitStatus,
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
} from './dto/visit.dtos';

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

  async create(requester: AuthenticatedUser, dto: CreateVisitDto) {
    const doctor = await this.profiles.getDoctorByUserId(requester.id);

    if (dto.appointmentId) {
      const appointment = await this.prisma.appointment.findUnique({
        where: { id: dto.appointmentId },
      });
      if (!appointment) throw new NotFoundException('Appointment not found.');
      if (appointment.doctorId !== doctor.id) {
        throw new ForbiddenException('This appointment belongs to another doctor.');
      }
      if (appointment.status === AppointmentStatus.CANCELLED) {
        throw new BadRequestException('Cannot start a visit from a cancelled appointment.');
      }
      const existing = await this.prisma.visit.findUnique({
        where: { appointmentId: appointment.id },
      });
      if (existing) {
        throw new BadRequestException('A visit already exists for this appointment.');
      }

      const [visit] = await this.prisma.$transaction([
        this.prisma.visit.create({
          data: {
            appointmentId: appointment.id,
            patientId: appointment.patientId,
            doctorId: doctor.id,
            type: dto.type ?? appointment.type,
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

    // Walk-in / emergency visit.
    if (!dto.patientId) {
      throw new BadRequestException('patientId is required for walk-in visits.');
    }
    const patient = await this.prisma.patientProfile.findUnique({
      where: { id: dto.patientId },
      select: { id: true },
    });
    if (!patient) throw new NotFoundException('Patient not found.');

    return this.prisma.visit.create({
      data: {
        patientId: patient.id,
        doctorId: doctor.id,
        type: dto.type,
        mainComplaint: dto.mainComplaint,
        notes: dto.notes,
      },
    });
  }

  async listMine(requester: AuthenticatedUser, page: number, limit: number) {
    let where: Record<string, unknown>;
    if (requester.role === Role.DOCTOR) {
      const doctor = await this.profiles.getDoctorByUserId(requester.id);
      where = { doctorId: doctor.id };
    } else {
      const patient = await this.profiles.getPatientByUserId(requester.id);
      where = { patientId: patient.id };
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.visit.findMany({
        where,
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
        assessments: true,
        diagnoses: true,
        medicalTests: { include: { result: { include: { file: true } } } },
        medicalImages: { include: { file: true } },
        treatmentPlans: true,
        doctor: {
          select: {
            id: true,
            specialization: true,
            user: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });
    if (!visit) throw new NotFoundException('Visit not found.');
    await this.consent.assertCanAccessPatient(
      requester,
      visit.patientId,
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

  async addDiagnosis(requester: AuthenticatedUser, visitId: number, dto: CreateDiagnosisDto) {
    const visit = await this.getOwnedVisit(requester, visitId, true);
    return this.prisma.diagnosis.create({ data: { visitId: visit.id, ...dto } });
  }

  async addTest(requester: AuthenticatedUser, visitId: number, dto: CreateMedicalTestDto) {
    const visit = await this.getOwnedVisit(requester, visitId, true);
    const doctor = await this.profiles.getDoctorByUserId(requester.id);
    return this.prisma.medicalTest.create({
      data: { visitId: visit.id, requestedById: doctor.id, ...dto },
    });
  }

  async addTestResult(requester: AuthenticatedUser, testId: number, dto: CreateTestResultDto) {
    const test = await this.prisma.medicalTest.findUnique({
      where: { id: testId },
      include: { visit: { select: { doctorId: true } }, result: true },
    });
    if (!test) throw new NotFoundException('Test not found.');
    const doctor = await this.profiles.getDoctorByUserId(requester.id);
    if (test.visit.doctorId !== doctor.id) {
      throw new ForbiddenException('This test belongs to another doctor.');
    }
    if (test.result) throw new BadRequestException('This test already has a result.');
    if (dto.fileId) await this.assertFileExists(dto.fileId);

    const [result] = await this.prisma.$transaction([
      this.prisma.testResult.create({ data: { testId, ...dto } }),
      this.prisma.medicalTest.update({
        where: { id: testId },
        data: { status: 'COMPLETED' },
      }),
    ]);
    return result;
  }

  async addImage(requester: AuthenticatedUser, visitId: number, dto: CreateMedicalImageDto) {
    const visit = await this.getOwnedVisit(requester, visitId, true);
    const doctor = await this.profiles.getDoctorByUserId(requester.id);
    await this.assertFileExists(dto.fileId);
    return this.prisma.medicalImage.create({
      data: { visitId: visit.id, orderedById: doctor.id, ...dto },
    });
  }

  // -------------------------------------------------------------------------
  // Assessments (patient self-report / doctor evaluation)
  // -------------------------------------------------------------------------

  async createAssessment(requester: AuthenticatedUser, dto: CreateAssessmentDto) {
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
        orderBy: { createdAt: 'desc' },
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
    const visit = await this.prisma.visit.findUnique({ where: { id: visitId } });
    if (!visit) throw new NotFoundException('Visit not found.');
    const doctor = await this.profiles.getDoctorByUserId(requester.id);
    if (visit.doctorId !== doctor.id) {
      throw new ForbiddenException('This visit belongs to another doctor.');
    }
    if (mustBeOpen && visit.status !== VisitStatus.OPEN) {
      throw new BadRequestException('This visit is closed — reopen is not supported.');
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
