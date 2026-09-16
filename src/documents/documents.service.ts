import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConsentType, DocumentStatus, Prisma, Role } from '@prisma/client';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ConsentService } from '../consent/consent.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProfilesService } from '../users/profiles.service';
import {
  CreateMedicalDocumentDto,
  ListMedicalDocumentsDto,
  UpdateMedicalDocumentDto,
} from './dto/document.dtos';

/**
 * ERD #12 MedicalDocument — the patient's document library (FR-011/FR-012).
 *
 * The binary lives in FileObject (uploads module); this row is the medical
 * metadata around it, including who uploaded it and when.
 */
@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly consent: ConsentService,
    private readonly profiles: ProfilesService,
  ) {}

  async create(requester: AuthenticatedUser, dto: CreateMedicalDocumentDto) {
    const patientId = await this.resolvePatientId(requester, dto.patientId);
    await this.consent.assertCanAccessPatient(
      requester,
      patientId,
      ConsentType.VIEW_RECORDS,
    );

    // The uploader must own the file — no attaching someone else's upload.
    const file = await this.prisma.fileObject.findUnique({
      where: { id: dto.fileId },
      select: { id: true, ownerId: true },
    });
    if (!file)
      throw new BadRequestException(`File ${dto.fileId} does not exist.`);
    if (file.ownerId !== requester.id && requester.role !== Role.ADMIN) {
      throw new ForbiddenException('fileId must be a file you uploaded.');
    }

    return this.prisma.medicalDocument.create({
      data: {
        patientId,
        uploadedById: requester.id,
        fileId: dto.fileId,
        name: dto.name,
        type: dto.type,
        description: dto.description,
      },
      include: { file: true },
    });
  }

  async listForPatient(
    requester: AuthenticatedUser,
    patientId: number,
    query: ListMedicalDocumentsDto,
  ) {
    await this.consent.assertCanAccessPatient(
      requester,
      patientId,
      ConsentType.VIEW_RECORDS,
    );
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.MedicalDocumentWhereInput = {
      patientId,
      status: query.status ?? DocumentStatus.ACTIVE,
      ...(query.type ? { type: query.type } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.medicalDocument.findMany({
        where,
        include: {
          file: { select: { id: true, url: true, mimeType: true, size: true } },
        },
        orderBy: { uploadDate: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.medicalDocument.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  async findOne(requester: AuthenticatedUser, id: number) {
    const document = await this.prisma.medicalDocument.findUnique({
      where: { id },
      include: { file: true },
    });
    if (!document || document.status === DocumentStatus.DELETED) {
      throw new NotFoundException('Document not found.');
    }
    await this.consent.assertCanAccessPatient(
      requester,
      document.patientId,
      ConsentType.VIEW_RECORDS,
    );
    return document;
  }

  async update(
    requester: AuthenticatedUser,
    id: number,
    dto: UpdateMedicalDocumentDto,
  ) {
    const document = await this.getEditable(requester, id);
    return this.prisma.medicalDocument.update({
      where: { id: document.id },
      data: dto,
      include: { file: true },
    });
  }

  /**
   * Soft delete — BRD §11.2: "historical clinical records should not be
   * silently overwritten where auditability is required".
   */
  async remove(requester: AuthenticatedUser, id: number) {
    const document = await this.getEditable(requester, id);
    return this.prisma.medicalDocument.update({
      where: { id: document.id },
      data: { status: DocumentStatus.DELETED },
    });
  }

  // -------------------------------------------------------------------------

  /** Only the uploader, the owning patient, or an admin may edit/remove. */
  private async getEditable(requester: AuthenticatedUser, id: number) {
    const document = await this.prisma.medicalDocument.findUnique({
      where: { id },
      include: { patient: { select: { userId: true } } },
    });
    if (!document) throw new NotFoundException('Document not found.');
    if (
      requester.role !== Role.ADMIN &&
      document.uploadedById !== requester.id &&
      document.patient.userId !== requester.id
    ) {
      throw new ForbiddenException(
        'Only the uploader or the patient can change this document.',
      );
    }
    return document;
  }

  private async resolvePatientId(
    requester: AuthenticatedUser,
    patientId?: number,
  ): Promise<number> {
    if (patientId) return patientId;
    if (requester.role !== Role.PATIENT) {
      throw new BadRequestException('patientId is required.');
    }
    const patient = await this.profiles.getPatientByUserId(requester.id);
    return patient.id;
  }
}
