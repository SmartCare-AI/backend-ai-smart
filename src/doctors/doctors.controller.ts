import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UserEntity } from '../users/entities/user.entity';
import { DoctorsService } from './doctors.service';
import {
  AdminListDoctorsDto,
  BecomeDoctorDto,
  SearchDoctorsDto,
  SetDoctorStatusDto,
  UpdateMyDoctorProfileDto,
} from './dto/doctor.dtos';
import {
  DoctorStatusResultEntity,
  PublicDoctorEntity,
  PublicDoctorPageEntity,
  SpecializationListEntity,
} from './entities/doctor.entities';

@ApiTags('Doctors')
@ApiBearerAuth('access-token')
@Controller('doctors')
export class DoctorsController {
  constructor(private readonly doctors: DoctorsService) {}

  @Get()
  @Public()
  @ApiOperation({
    summary: 'Search doctors (public directory)',
    description:
      'Active doctors with a verified email. Filter by `specialization` (pass the AI triage `doctorSearch.specialization` straight through), name (`q`) or `hospitalId`. Most experienced first.',
  })
  @ApiResponse({ status: 200, type: PublicDoctorPageEntity })
  search(@Query() query: SearchDoctorsDto) {
    return this.doctors.search(query);
  }

  @Get('specializations')
  @Public()
  @ApiOperation({
    summary: 'The fixed specialization keys',
    description:
      'Lowercase keys used for registration, search and AI triage. Apps translate them for display.',
  })
  @ApiResponse({ status: 200, type: SpecializationListEntity })
  specializations() {
    return this.doctors.specializations();
  }

  @Get('me')
  @Roles(Role.DOCTOR)
  @ApiOperation({ summary: 'My doctor profile (includes license number)' })
  getMine(@CurrentUser() user: AuthenticatedUser) {
    return this.doctors.getMine(user.id);
  }

  @Patch('me')
  @Roles(Role.DOCTOR)
  @ApiOperation({
    summary: 'Edit my professional details',
    description:
      'Partial update. The license number cannot be changed after registration.',
  })
  updateMine(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateMyDoctorProfileDto,
  ) {
    return this.doctors.updateMine(user.id, dto);
  }

  @Post('me/profile')
  @ApiOperation({
    summary: 'Become a doctor (existing account)',
    description:
      'For accounts created by Google/Apple sign-in (which start as patients): adds a doctor profile and switches the active role to DOCTOR. The patient profile is kept.',
  })
  @ApiResponse({ status: 201, type: UserEntity })
  @ApiResponse({
    status: 409,
    description: 'Already a doctor, or license number in use.',
  })
  becomeDoctor(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: BecomeDoctorDto,
  ) {
    return this.doctors.becomeDoctor(user.id, dto);
  }

  @Get(':id')
  @Public()
  @ApiOperation({ summary: 'Public doctor profile' })
  @ApiResponse({ status: 200, type: PublicDoctorEntity })
  @ApiResponse({ status: 404, description: 'Unknown, suspended or unverified.' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.doctors.findPublic(id);
  }
}

@ApiTags('Doctors')
@ApiBearerAuth('access-token')
@Roles(Role.ADMIN)
@Controller('admin/doctors')
export class AdminDoctorsController {
  constructor(private readonly doctors: DoctorsService) {}

  @Get()
  @ApiOperation({
    summary: 'All doctors including suspended ones (admin)',
    description: 'Search by name, email or license number.',
  })
  list(@Query() query: AdminListDoctorsDto) {
    return this.doctors.adminList(query);
  }

  @Patch(':id/status')
  @ApiOperation({
    summary: 'Suspend or reactivate a doctor (admin)',
    description:
      'SUSPENDED hides the doctor from search, blocks record access and cancels their future appointments (patients are notified).',
  })
  @ApiResponse({ status: 200, type: DoctorStatusResultEntity })
  setStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetDoctorStatusDto,
  ) {
    return this.doctors.setStatus(id, dto);
  }
}
