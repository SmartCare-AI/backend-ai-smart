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
import { AppointmentsService } from './appointments.service';
import {
  CancelAppointmentDto,
  CreateAppointmentDto,
  DoctorScheduleDto,
  ListAppointmentsDto,
} from './dto/appointment.dtos';
import { AppointmentEntity } from './entities/appointment.entity';

@ApiTags('Appointments')
@ApiBearerAuth('access-token')
@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  @Post()
  @ApiOperation({
    summary: 'Book an appointment',
    description:
      'Patients book for themselves; caregivers need MANAGE_APPOINTMENTS permission for the patient. Rejects slots overlapping an existing pending/confirmed appointment of the doctor.',
  })
  @ApiResponse({ status: 201, type: AppointmentEntity })
  @ApiResponse({ status: 403, description: 'No permission to book for this patient.' })
  @ApiResponse({ status: 409, description: 'Doctor is busy in that time slot.' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateAppointmentDto,
  ) {
    return this.appointmentsService.create(user, dto);
  }

  @Get('my')
  @ApiOperation({
    summary: 'My appointments (patient sees own, doctor sees own)',
  })
  @ApiResponse({ status: 200, description: 'Paginated { items, total, page, limit }.' })
  listMine(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListAppointmentsDto,
  ) {
    return this.appointmentsService.listMine(user, query);
  }

  @Get('doctors/:doctorId/schedule')
  @ApiOperation({
    summary: "A doctor's busy slots on a day (to render free slots)",
  })
  @ApiResponse({ status: 200, description: '{ doctorId, date, busy: [{scheduledAt, endsAt}] }' })
  doctorSchedule(
    @Param('doctorId', ParseIntPipe) doctorId: number,
    @Query() query: DoctorScheduleDto,
  ) {
    return this.appointmentsService.doctorSchedule(doctorId, query.date);
  }

  @Patch(':id/confirm')
  @Roles(Role.DOCTOR)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm a pending appointment (treating doctor)' })
  @ApiResponse({ status: 200, type: AppointmentEntity })
  confirm(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.appointmentsService.confirm(user, id);
  }

  @Patch(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel an appointment (doctor, patient, or authorized caregiver)',
  })
  @ApiResponse({ status: 200, type: AppointmentEntity })
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CancelAppointmentDto,
  ) {
    return this.appointmentsService.cancel(user, id, dto.reason);
  }
}
