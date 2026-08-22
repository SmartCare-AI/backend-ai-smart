import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CreateDepartmentDto,
  CreateHospitalDto,
  UpdateHospitalDto,
} from './dto/hospital.dtos';
import {
  DepartmentEntity,
  HospitalEntity,
} from './entities/hospital.entities';
import { HospitalsService } from './hospitals.service';

@ApiTags('Hospitals')
@ApiBearerAuth('access-token')
@Controller('hospitals')
export class HospitalsController {
  constructor(private readonly hospitalsService: HospitalsService) {}

  @Get()
  @ApiOperation({ summary: 'List active hospitals with their departments' })
  @ApiResponse({ status: 200, type: [HospitalEntity] })
  findAll() {
    return this.hospitalsService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Hospital details' })
  @ApiResponse({ status: 200, type: HospitalEntity })
  @ApiResponse({ status: 404, description: 'Hospital not found.' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.hospitalsService.findOne(id);
  }

  @Get(':id/doctors')
  @ApiOperation({ summary: 'Verified doctors of a hospital (for booking)' })
  listDoctors(@Param('id', ParseIntPipe) id: number) {
    return this.hospitalsService.listDoctors(id);
  }

  @Post()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Create a hospital (admin)' })
  @ApiResponse({ status: 201, type: HospitalEntity })
  create(@Body() dto: CreateHospitalDto) {
    return this.hospitalsService.create(dto);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Update a hospital (admin)' })
  @ApiResponse({ status: 200, type: HospitalEntity })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateHospitalDto,
  ) {
    return this.hospitalsService.update(id, dto);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Deactivate a hospital (admin, soft delete)' })
  @ApiResponse({ status: 200, type: HospitalEntity })
  deactivate(@Param('id', ParseIntPipe) id: number) {
    return this.hospitalsService.deactivate(id);
  }

  @Post(':id/departments')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Add a department to a hospital (admin)' })
  @ApiResponse({ status: 201, type: DepartmentEntity })
  @ApiResponse({ status: 409, description: 'Department name already exists here.' })
  addDepartment(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateDepartmentDto,
  ) {
    return this.hospitalsService.addDepartment(id, dto);
  }
}
