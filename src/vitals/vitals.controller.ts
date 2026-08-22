import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
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
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import {
  RecordVitalDto,
  RecordVitalsBatchDto,
  VitalsSeriesQueryDto,
} from './dto/vital.dtos';
import { VitalsService } from './vitals.service';

@ApiTags('Vitals')
@ApiBearerAuth('access-token')
@Controller('vitals')
export class VitalsController {
  constructor(private readonly vitalsService: VitalsService) {}

  @Post()
  @Roles(Role.PATIENT)
  @ApiOperation({
    summary: 'Record a vital sign (manual entry or single device reading)',
    description:
      'Automatically checked against clinical thresholds — abnormal values raise an Alert to the treating doctor and caregivers; CRITICAL values also create an EmergencyEvent.',
  })
  @ApiResponse({ status: 201, description: 'The recorded vital sign.' })
  record(@CurrentUser() user: AuthenticatedUser, @Body() dto: RecordVitalDto) {
    return this.vitalsService.record(user, dto);
  }

  @Post('batch')
  @Roles(Role.PATIENT)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Sync a batch of readings (smartwatch / IoT device)',
    description:
      'Up to 100 readings. Threshold alerts fire at most once per vital type per batch (worst reading wins).',
  })
  @ApiResponse({ status: 201, schema: { example: { recorded: 42 } } })
  recordBatch(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RecordVitalsBatchDto,
  ) {
    return this.vitalsService.recordBatch(user, dto);
  }

  @Get('patients/:patientId')
  @ApiOperation({
    summary: "A patient's vitals time-series (for charts)",
    description:
      'Ascending by time, filter by type and range. Access: the patient, treating doctor, or caregiver with VIEW_RECORDS.',
  })
  series(
    @CurrentUser() user: AuthenticatedUser,
    @Param('patientId', ParseIntPipe) patientId: number,
    @Query() query: VitalsSeriesQueryDto,
  ) {
    return this.vitalsService.series(user, patientId, query);
  }
}
