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
import {
  CreateOnlineVisitDto,
  EndOnlineVisitDto,
  ListOnlineVisitsDto,
} from './dto/online-visit.dtos';
import { TelemedicineService } from './telemedicine.service';

/**
 * ERD #26 Online Visit. VIDEO/CHAT appointments provision a session
 * automatically at booking time; these endpoints drive its lifecycle.
 * Real-time audio/video runs over the Socket.IO `call:*` events.
 */
@ApiTags('Telemedicine')
@ApiBearerAuth('access-token')
@Controller('online-visits')
export class TelemedicineController {
  constructor(private readonly telemedicine: TelemedicineService) {}

  @Post()
  @ApiOperation({
    summary: 'Open an online visit for an appointment',
    description:
      'Normally unnecessary — booking a VIDEO/CHAT appointment creates one automatically. Use this to add a remote session to an existing appointment.',
  })
  @ApiResponse({ status: 201, description: 'The created online visit.' })
  @ApiResponse({
    status: 400,
    description: 'Appointment already has an online visit, or is cancelled.',
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateOnlineVisitDto,
  ) {
    return this.telemedicine.create(user, dto);
  }

  @Get('my')
  @ApiOperation({
    summary: 'My online visits (patient sees own, doctor sees own)',
  })
  listMine(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListOnlineVisitsDto,
  ) {
    return this.telemedicine.listMine(user, query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Online visit details (includes the meeting link)',
    description: 'Only the appointment’s patient and doctor may read it.',
  })
  @ApiResponse({ status: 403, description: 'Not a participant.' })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.telemedicine.findOne(user, id);
  }

  @Patch(':id/start')
  @Roles(Role.DOCTOR)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Start the session (doctor)',
    description: 'Marks it ACTIVE and pushes a "join now" notification to the patient.',
  })
  start(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.telemedicine.start(user, id);
  }

  @Patch(':id/end')
  @Roles(Role.DOCTOR)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'End the session (doctor)',
    description: 'Records EndTime, stores session notes, and completes the appointment.',
  })
  end(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: EndOnlineVisitDto,
  ) {
    return this.telemedicine.end(user, id, dto);
  }

  @Patch(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a scheduled session' })
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.telemedicine.cancel(user, id);
  }
}
