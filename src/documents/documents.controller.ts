import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { DocumentsService } from './documents.service';
import {
  CreateMedicalDocumentDto,
  ListMedicalDocumentsDto,
  UpdateMedicalDocumentDto,
} from './dto/document.dtos';

/**
 * ERD #12 MedicalDocument — reports, discharge summaries, insurance papers.
 */
@ApiTags('Medical Documents')
@ApiBearerAuth('access-token')
@Controller('medical-documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post()
  @ApiOperation({
    summary: 'File an uploaded document into a patient record',
    description:
      'Upload the file first via POST /uploads, then attach it here. FR-012: the uploader and upload date are recorded automatically.',
  })
  @ApiResponse({ status: 201, description: 'The stored document with its file.' })
  @ApiResponse({ status: 403, description: 'No access to this patient record.' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateMedicalDocumentDto,
  ) {
    return this.documentsService.create(user, dto);
  }

  @Get('patients/:patientId')
  @ApiOperation({
    summary: "A patient's document library",
    description:
      'Access: the patient, treating doctor, or caregiver with VIEW_RECORDS. Returns ACTIVE documents unless another status is requested.',
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('patientId', ParseIntPipe) patientId: number,
    @Query() query: ListMedicalDocumentsDto,
  ) {
    return this.documentsService.listForPatient(user, patientId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Document details (with the file URL)' })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.documentsService.findOne(user, id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Rename / reclassify / archive a document',
    description: 'Allowed for the uploader, the owning patient, or an admin.',
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateMedicalDocumentDto,
  ) {
    return this.documentsService.update(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Remove a document (soft delete)',
    description:
      'Sets status DELETED and hides it from the library; the record is retained for auditability.',
  })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.documentsService.remove(user, id);
  }
}
