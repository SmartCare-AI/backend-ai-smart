import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AlertStatus, Role } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';
import { AlertsService } from './alerts.service';

class ListAlertsDto extends PaginationDto {
  @ApiPropertyOptional({ enum: AlertStatus })
  @IsOptional()
  @IsEnum(AlertStatus)
  status?: AlertStatus;
}

class UpdateAlertStatusDto {
  @ApiProperty({ enum: AlertStatus, example: AlertStatus.ACKNOWLEDGED })
  @IsEnum(AlertStatus)
  status!: AlertStatus;
}

@ApiTags('Alerts')
@ApiBearerAuth('access-token')
@Controller('alerts')
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Get('my-patients')
  @Roles(Role.DOCTOR)
  @ApiOperation({
    summary: 'Smart Alert Center: active alerts across my patients (doctor)',
    description: 'Sorted most-severe first. Includes patient name and MRN.',
  })
  listForDoctor(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PaginationDto,
  ) {
    return this.alertsService.listForDoctor(
      user,
      query.page ?? 1,
      query.limit ?? 20,
    );
  }

  @Get('patients/:patientId')
  @ApiOperation({
    summary: "A patient's alert history",
    description: 'Access: the patient, treating doctor, or caregiver with RECEIVE_ALERTS.',
  })
  listForPatient(
    @CurrentUser() user: AuthenticatedUser,
    @Param('patientId', ParseIntPipe) patientId: number,
    @Query() query: ListAlertsDto,
  ) {
    return this.alertsService.listForPatient(
      user,
      patientId,
      query.status,
      query.page ?? 1,
      query.limit ?? 20,
    );
  }

  @Patch(':id/status')
  @Roles(Role.DOCTOR)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Acknowledge / resolve / dismiss an alert (treating doctor)' })
  @ApiResponse({ status: 403, description: 'Not a treating doctor for this patient.' })
  updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAlertStatusDto,
  ) {
    return this.alertsService.updateStatus(user, id, dto.status);
  }
}
