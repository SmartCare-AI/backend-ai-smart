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
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';
import {
  CreatePrescriptionDto,
  CreateTreatmentPlanDto,
  SearchMedicinesDto,
  SkipDoseDto,
  UpdatePlanStatusDto,
} from './dto/treatment.dtos';
import { TreatmentService } from './treatment.service';

@ApiTags('Treatment')
@ApiBearerAuth('access-token')
@Controller('treatment-plans')
export class TreatmentPlansController {
  constructor(private readonly treatmentService: TreatmentService) {}

  @Post()
  @Roles(Role.DOCTOR)
  @ApiOperation({
    summary: 'Create a treatment plan',
    description:
      'Requires a treating relationship with the patient. BR-006: the diagnosis link is optional, but when given it must belong to the same patient.',
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateTreatmentPlanDto,
  ) {
    return this.treatmentService.createPlan(user, dto);
  }

  @Get('patients/:patientId')
  @ApiOperation({
    summary: "A patient's treatment plans",
    description:
      'Access: the patient, treating doctor, or caregiver with VIEW_RECORDS.',
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('patientId', ParseIntPipe) patientId: number,
    @Query() query: PaginationDto,
  ) {
    return this.treatmentService.listPlans(
      user,
      patientId,
      query.page ?? 1,
      query.limit ?? 20,
    );
  }

  @Patch(':id/status')
  @Roles(Role.DOCTOR)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update plan status (owning doctor)' })
  updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePlanStatusDto,
  ) {
    return this.treatmentService.updatePlanStatus(user, id, dto);
  }
}

@ApiTags('Treatment')
@ApiBearerAuth('access-token')
@Controller('prescriptions')
export class PrescriptionsController {
  constructor(private readonly treatmentService: TreatmentService) {}

  @Post()
  @Roles(Role.DOCTOR)
  @ApiOperation({
    summary: 'Issue a prescription under a treatment plan',
    description:
      'BR-007: the prescription hangs off a treatment plan, which supplies the patient and prescribing doctor. Creates the prescription + items and GENERATES the full MedicineTracking schedule (timesPerDay × durationDays rows per item) that powers reminders and adherence tracking. The patient is notified.',
  })
  @ApiResponse({
    status: 201,
    description: 'Prescription with items and medicines.',
  })
  @ApiResponse({
    status: 400,
    description: 'The treatment plan is not ACTIVE.',
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePrescriptionDto,
  ) {
    return this.treatmentService.createPrescription(user, dto);
  }

  @Get('patients/:patientId')
  @ApiOperation({ summary: "A patient's prescriptions" })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('patientId', ParseIntPipe) patientId: number,
    @Query() query: PaginationDto,
  ) {
    return this.treatmentService.listPrescriptions(
      user,
      patientId,
      query.page ?? 1,
      query.limit ?? 20,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Prescription details (items + medicines)' })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.treatmentService.getPrescription(user, id);
  }
}

@ApiTags('Treatment')
@ApiBearerAuth('access-token')
@Controller('medicines')
export class MedicinesController {
  constructor(private readonly treatmentService: TreatmentService) {}

  @Get()
  @ApiOperation({
    summary: 'Search the medicine catalog (ERD #19)',
    description:
      'Type-ahead source for the prescribing screen. Matches name or generic name.',
  })
  search(@Query() query: SearchMedicinesDto) {
    return this.treatmentService.searchMedicines(query);
  }
}

@ApiTags('Treatment')
@ApiBearerAuth('access-token')
@Controller('medications')
export class MedicationsController {
  constructor(private readonly treatmentService: TreatmentService) {}

  @Get('doses/upcoming')
  @Roles(Role.PATIENT)
  @ApiOperation({
    summary: 'My upcoming medication doses',
    description:
      'Doses due within the window (default 24h), plus a 1-hour grace period backwards.',
  })
  @ApiQuery({ name: 'hours', required: false, example: 24 })
  upcoming(
    @CurrentUser() user: AuthenticatedUser,
    @Query('hours') hours?: string,
  ) {
    const window = Math.min(Math.max(parseInt(hours ?? '24', 10) || 24, 1), 168);
    return this.treatmentService.upcomingDoses(user, window);
  }

  @Patch('doses/:id/take')
  @Roles(Role.PATIENT)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark a dose as taken' })
  @ApiResponse({ status: 400, description: 'Dose already taken/missed/skipped.' })
  take(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.treatmentService.takeDose(user, id);
  }

  @Patch('doses/:id/skip')
  @Roles(Role.PATIENT)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark a dose as deliberately skipped',
    description:
      'Distinct from MISSED: a skip is recorded with a reason and does not count against the adherence score.',
  })
  skip(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SkipDoseDto,
  ) {
    return this.treatmentService.skipDose(user, id, dto);
  }

  @Get('adherence/patients/:patientId')
  @ApiOperation({
    summary: 'Medication adherence score',
    description:
      'TAKEN / (TAKEN + MISSED) over the window (default 30 days). Access: the patient, treating doctor, or caregiver with VIEW_RECORDS.',
  })
  @ApiQuery({ name: 'days', required: false, example: 30 })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        patientId: 1,
        windowDays: 30,
        taken: 52,
        missed: 4,
        skipped: 1,
        upcoming: 12,
        score: 0.93,
      },
    },
  })
  adherence(
    @CurrentUser() user: AuthenticatedUser,
    @Param('patientId', ParseIntPipe) patientId: number,
    @Query('days') days?: string,
  ) {
    const window = Math.min(Math.max(parseInt(days ?? '30', 10) || 30, 1), 365);
    return this.treatmentService.adherence(user, patientId, window);
  }
}
