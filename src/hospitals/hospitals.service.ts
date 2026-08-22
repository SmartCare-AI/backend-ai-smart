import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateDepartmentDto,
  CreateHospitalDto,
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
      where: { isActive: true },
      include: { departments: { where: { isActive: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: number) {
    const hospital = await this.prisma.hospital.findUnique({
      where: { id },
      include: {
        departments: { where: { isActive: true } },
      },
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
      data: { isActive: false },
    });
  }

  async addDepartment(hospitalId: number, dto: CreateDepartmentDto) {
    await this.findOne(hospitalId);
    const existing = await this.prisma.department.findUnique({
      where: { hospitalId_name: { hospitalId, name: dto.name } },
    });
    if (existing) {
      throw new ConflictException('A department with this name already exists in this hospital.');
    }
    return this.prisma.department.create({ data: { hospitalId, ...dto } });
  }

  /** Doctors of a hospital — what patients browse before booking. */
  async listDoctors(hospitalId: number) {
    await this.findOne(hospitalId);
    return this.prisma.doctorProfile.findMany({
      where: { hospitalId, isVerified: true },
      select: {
        id: true,
        specialization: true,
        yearsOfExperience: true,
        bio: true,
        departmentId: true,
        user: {
          select: { firstName: true, lastName: true, avatarUrl: true },
        },
      },
    });
  }
}
