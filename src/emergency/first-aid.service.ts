import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateFirstAidGuideDto,
  UpdateFirstAidGuideDto,
} from './dto/emergency.dtos';

/**
 * First-aid knowledge base. The list endpoint returns FULL content of all
 * published guides so the mobile app can cache everything locally and work
 * with zero connectivity — the whole point of first aid.
 */
@Injectable()
export class FirstAidService {
  constructor(private readonly prisma: PrismaService) {}

  listPublished(category?: string) {
    return this.prisma.firstAidGuide.findMany({
      where: { isPublished: true, ...(category ? { category } : {}) },
      orderBy: [{ category: 'asc' }, { title: 'asc' }],
      include: { mediaFile: { select: { url: true, mimeType: true } } },
    });
  }

  async findBySlug(slug: string) {
    const guide = await this.prisma.firstAidGuide.findUnique({
      where: { slug },
      include: { mediaFile: { select: { url: true, mimeType: true } } },
    });
    if (!guide || !guide.isPublished) {
      throw new NotFoundException('Guide not found.');
    }
    return guide;
  }

  /** Admin view includes drafts. */
  listAll() {
    return this.prisma.firstAidGuide.findMany({
      orderBy: [{ category: 'asc' }, { title: 'asc' }],
    });
  }

  async create(dto: CreateFirstAidGuideDto) {
    const existing = await this.prisma.firstAidGuide.findUnique({
      where: { slug: dto.slug },
      select: { id: true },
    });
    if (existing) throw new ConflictException('A guide with this slug already exists.');
    return this.prisma.firstAidGuide.create({ data: dto });
  }

  async update(id: number, dto: UpdateFirstAidGuideDto) {
    const guide = await this.prisma.firstAidGuide.findUnique({ where: { id } });
    if (!guide) throw new NotFoundException('Guide not found.');
    if (dto.slug && dto.slug !== guide.slug) {
      const clash = await this.prisma.firstAidGuide.findUnique({
        where: { slug: dto.slug },
        select: { id: true },
      });
      if (clash) throw new ConflictException('A guide with this slug already exists.');
    }
    return this.prisma.firstAidGuide.update({ where: { id }, data: dto });
  }

  async remove(id: number) {
    const guide = await this.prisma.firstAidGuide.findUnique({ where: { id } });
    if (!guide) throw new NotFoundException('Guide not found.');
    await this.prisma.firstAidGuide.delete({ where: { id } });
  }
}
