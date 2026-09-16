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
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { DevicesService } from './devices.service';
import {
  ListReadingsDto,
  RegisterDeviceDto,
  SyncReadingsDto,
  UpdateDeviceDto,
} from './dto/device.dtos';

/**
 * ERD #22 Device / #23 DeviceReading — wearables and IoT health devices.
 */
@ApiTags('Devices')
@ApiBearerAuth('access-token')
@Controller('devices')
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @Post()
  @Roles(Role.PATIENT)
  @ApiOperation({
    summary: 'Pair a health device',
    description:
      'Re-registering the same serial number reconnects the existing device instead of creating a duplicate.',
  })
  @ApiResponse({ status: 201, description: 'The paired device.' })
  @ApiResponse({
    status: 409,
    description: 'Serial number already paired with another patient.',
  })
  register(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RegisterDeviceDto,
  ) {
    return this.devicesService.register(user, dto);
  }

  @Get('my')
  @Roles(Role.PATIENT)
  @ApiOperation({ summary: 'My paired devices' })
  listMine(@CurrentUser() user: AuthenticatedUser) {
    return this.devicesService.listMine(user);
  }

  @Get('patients/:patientId')
  @ApiOperation({
    summary: "A patient's devices (doctor / caregiver monitoring view)",
    description: 'Access: the patient, treating doctor, or caregiver with VIEW_RECORDS.',
  })
  listForPatient(
    @CurrentUser() user: AuthenticatedUser,
    @Param('patientId', ParseIntPipe) patientId: number,
  ) {
    return this.devicesService.listForPatient(user, patientId);
  }

  @Patch(':id')
  @Roles(Role.PATIENT)
  @ApiOperation({ summary: 'Update device metadata or status' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDeviceDto,
  ) {
    return this.devicesService.update(user, id, dto);
  }

  @Delete(':id')
  @Roles(Role.PATIENT)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Unpair a device',
    description:
      'Marks it DISCONNECTED. Past readings are kept — they are part of the clinical history.',
  })
  disconnect(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.devicesService.disconnect(user, id);
  }

  @Post(':id/readings')
  @Roles(Role.PATIENT)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Sync raw readings from the device',
    description:
      'Stores up to 200 DeviceReading rows and (unless promoteToVitals=false) mirrors them into the clinical vitals stream, where threshold alerts fire — at most one alert per vital type per sync.',
  })
  @ApiResponse({
    status: 201,
    schema: { example: { deviceId: 1, received: 42, promotedToVitals: 42 } },
  })
  sync(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SyncReadingsDto,
  ) {
    return this.devicesService.sync(user, id, dto);
  }

  @Get(':id/readings')
  @ApiOperation({
    summary: 'Raw readings produced by a device',
    description:
      'BR-009: patient context is resolved through the device, so access follows that patient’s consent rules.',
  })
  listReadings(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: ListReadingsDto,
  ) {
    return this.devicesService.listReadings(user, id, query);
  }
}
