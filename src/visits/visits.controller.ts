import {
  Body,
  Controller,
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
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';
import {
  CloseVisitDto,
  CreateDiagnosisDto,
  CreateMedicalImageDto,
  CreateMedicalTestDto,
  CreateTestResultDto,
  CreateVisitDto,
} from './dto/visit.dtos';
import { VisitsService } from './visits.service';

@ApiTags('Visits')
@ApiBearerAuth('access-token')
@Controller('visits')
export class VisitsController {
  constructor(private readonly visitsService: VisitsService) {}

  @Post()
  @Roles(Role.DOCTOR)
  @ApiOperation({
    summary: 'Start a visit (from an appointment, or walk-in)',
    description:
      'With appointmentId: creates the encounter and marks the appointment COMPLETED. Without: walk-in visit, patientId required.',
  })
  @ApiResponse({ status: 201, description: 'The created visit.' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateVisitDto) {
    return this.visitsService.create(user, dto);
  }

  @Get('my')
  @ApiOperation({ summary: 'My visits (patient or doctor view)' })
  listMine(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PaginationDto,
  ) {
    return this.visitsService.listMine(user, query.page ?? 1, query.limit ?? 20);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Full visit record (assessments, diagnoses, tests, images, plans)',
    description: 'Access: the patient, the treating doctor, or a caregiver with VIEW_RECORDS.',
  })
  @ApiResponse({ status: 403, description: 'No consent to view this record.' })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.visitsService.findOne(user, id);
  }

  @Patch(':id/close')
  @Roles(Role.DOCTOR)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Close a visit (optionally flag follow-up)' })
  close(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CloseVisitDto,
  ) {
    return this.visitsService.close(user, id, dto);
  }

  @Post(':id/diagnoses')
  @Roles(Role.DOCTOR)
  @ApiOperation({ summary: 'Add a diagnosis to an open visit' })
  addDiagnosis(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateDiagnosisDto,
  ) {
    return this.visitsService.addDiagnosis(user, id, dto);
  }

  @Post(':id/tests')
  @Roles(Role.DOCTOR)
  @ApiOperation({ summary: 'Request a medical test on an open visit' })
  addTest(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateMedicalTestDto,
  ) {
    return this.visitsService.addTest(user, id, dto);
  }

  @Post(':id/images')
  @Roles(Role.DOCTOR)
  @ApiOperation({
    summary: 'Attach a radiology image to an open visit',
    description: 'Upload the file first via POST /uploads (purpose RADIOLOGY), then pass its fileId.',
  })
  addImage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateMedicalImageDto,
  ) {
    return this.visitsService.addImage(user, id, dto);
  }
}

@ApiTags('Visits')
@ApiBearerAuth('access-token')
@Controller('tests')
export class TestsController {
  constructor(private readonly visitsService: VisitsService) {}

  @Post(':id/result')
  @Roles(Role.DOCTOR)
  @ApiOperation({
    summary: 'Record the result of a requested test',
    description: 'Marks the test COMPLETED. Optional fileId attaches the lab report.',
  })
  @ApiResponse({ status: 400, description: 'Test already has a result.' })
  addResult(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateTestResultDto,
  ) {
    return this.visitsService.addTestResult(user, id, dto);
  }
}
