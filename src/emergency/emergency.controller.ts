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
import { Role } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CreateEmergencyContactDto,
  ListEmergencyDto,
  ResolveEmergencyDto,
  SosDto,
  UpdateEmergencyContactDto,
} from './dto/emergency.dtos';
import { EmergencyService } from './emergency.service';

@ApiTags('Emergency')
@ApiBearerAuth('access-token')
@Controller('emergency')
export class EmergencyController {
  constructor(private readonly emergencyService: EmergencyService) {}

  @Post('sos')
  @Roles(Role.PATIENT)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: '🚨 SOS — I need help now',
    description:
      'Opens an emergency: instant high-priority push to all caregivers and treating doctors. If nobody acknowledges within the escalation window (default 2 min), emergency contacts receive an SMS with the GPS location. Repeated presses within 10 min reuse the active event.',
  })
  @ApiResponse({ status: 201, description: 'The emergency event (ACTIVE).' })
  sos(@CurrentUser() user: AuthenticatedUser, @Body() dto: SosDto) {
    return this.emergencyService.sos(user, dto);
  }

  @Patch(':id/acknowledge')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '"I\'m on it" — acknowledge an emergency',
    description:
      'Stops the SMS escalation and reassures the patient. Allowed: caregivers with alert access, treating doctors, admins.',
  })
  @ApiResponse({ status: 400, description: 'Already acknowledged/resolved.' })
  acknowledge(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.emergencyService.acknowledge(user, id);
  }

  @Patch(':id/resolve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Close an emergency (resolved or false alarm)',
    description: 'The patient may close their own event; circle members may close too.',
  })
  resolve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ResolveEmergencyDto,
  ) {
    return this.emergencyService.resolve(user, id, dto.falseAlarm ?? false);
  }

  @Get('patients/:patientId')
  @ApiOperation({
    summary: "A patient's emergency history",
    description: 'Access: the patient, treating doctor, or caregiver with RECEIVE_ALERTS.',
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('patientId', ParseIntPipe) patientId: number,
    @Query() query: ListEmergencyDto,
  ) {
    return this.emergencyService.list(user, patientId, query);
  }
}

@ApiTags('Emergency')
@ApiBearerAuth('access-token')
@Controller('emergency/contacts')
export class EmergencyContactsController {
  constructor(private readonly emergencyService: EmergencyService) {}

  @Get()
  @Roles(Role.PATIENT)
  @ApiOperation({ summary: 'My emergency contacts (SMS recipients, by priority)' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.emergencyService.listContacts(user);
  }

  @Post()
  @Roles(Role.PATIENT)
  @ApiOperation({
    summary: 'Add an emergency contact',
    description: 'People who are NOT app users — they get SMS. Max 5. Platform caregivers are managed separately (Family Portal).',
  })
  @ApiResponse({ status: 400, description: 'Contact limit reached.' })
  add(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateEmergencyContactDto,
  ) {
    return this.emergencyService.addContact(user, dto);
  }

  @Patch(':id')
  @Roles(Role.PATIENT)
  @ApiOperation({ summary: 'Update an emergency contact' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateEmergencyContactDto,
  ) {
    return this.emergencyService.updateContact(user, id, dto);
  }

  @Delete(':id')
  @Roles(Role.PATIENT)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove an emergency contact' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    await this.emergencyService.removeContact(user, id);
  }
}
