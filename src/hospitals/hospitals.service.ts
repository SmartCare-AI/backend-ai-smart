import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityStatus, ProfileStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateDepartmentDto,
  CreateHospitalDto,
  UpdateDepartmentDto,
  UpdateHospitalDto,
} from './dto/hospital.dtos';

@Injectable()
export class HospitalsService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateHospitalDto) {
    return this.prisma.hospital.create({ data: dto });
  }

  findAll() {
    return this.prisma.hospital.findMany({
      where: { status: EntityStatus.ACTIVE },
      include: { departments: { where: { status: EntityStatus.ACTIVE } } },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: number) {
    const hospital = await this.prisma.hospital.findUnique({
      where: { id },
      include: { departments: { where: { status: EntityStatus.ACTIVE } } },
    });
    if (!hospital) throw new NotFoundException('Hospital not found.');
    return hospital;
  }

  async update(id: number, dto: UpdateHospitalDto) {
    await this.findOne(id);
    return this.prisma.hospital.update({ where: { id }, data: dto });
  }

  /** Soft delete — medical data referencing the hospital must survive. */
  async deactivate(id: number) {
    await this.findOne(id);
    return this.prisma.hospital.update({
      where: { id },
      data: { status: EntityStatus.INACTIVE },
    });
  }

  async addDepartment(hospitalId: number, dto: CreateDepartmentDto) {
    await this.findOne(hospitalId);
    const existing = await this.prisma.department.findUnique({
      where: { hospitalId_name: { hospitalId, name: dto.name } },
    });
    if (existing) {
      throw new ConflictException(
        'A department with this name already exists in this hospital.',
      );
    }
    return this.prisma.department.create({ data: { hospitalId, ...dto } });
  }

  async updateDepartment(departmentId: number, dto: UpdateDepartmentDto) {
    const department = await this.prisma.department.findUnique({
      where: { id: departmentId },
    });
    if (!department) throw new NotFoundException('Department not found.');
    if (dto.name && dto.name !== department.name) {
      const clash = await this.prisma.department.findUnique({
        where: {
          hospitalId_name: {
            hospitalId: department.hospitalId,
            name: dto.name,
          },
        },
        select: { id: true },
      });
      if (clash) {
        throw new ConflictException(
          'A department with this name already exists in this hospital.',
        );
      }
    }
    return this.prisma.department.update({
      where: { id: departmentId },
      data: dto,
    });
  }

  /** Doctors of a hospital — what patients browse before booking. */
  async listDoctors(hospitalId: number) {
    await this.findOne(hospitalId);
    return this.prisma.doctorProfile.findMany({
      where: {
        hospitalId,
        isVerified: true,
        status: ProfileStatus.ACTIVE,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        specialization: true,
        yearsOfExperience: true,
        bio: true,
        departmentId: true,
        user: { select: { id: true, avatarUrl: true } },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
  }
}
