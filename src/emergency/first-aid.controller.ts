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
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CreateFirstAidGuideDto,
  UpdateFirstAidGuideDto,
} from './dto/emergency.dtos';
import { FirstAidService } from './first-aid.service';

@ApiTags('First Aid')
@Controller('first-aid')
export class FirstAidController {
  constructor(private readonly firstAidService: FirstAidService) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: 'All published first-aid guides (full content)',
    description:
      'Public — no login needed in an emergency. The mobile app downloads everything on first launch and re-syncs when updatedAt changes, so guides work offline.',
  })
  @ApiQuery({ name: 'category', required: false, example: 'bleeding' })
  list(@Query('category') category?: string) {
    return this.firstAidService.listPublished(category);
  }

  @Public()
  @Get(':slug')
  @ApiOperation({ summary: 'One guide by slug (public)' })
  @ApiResponse({ status: 404, description: 'Not found or not published.' })
  findBySlug(@Param('slug') slug: string) {
    return this.firstAidService.findBySlug(slug);
  }

  @Get('admin/all')
  @Roles(Role.ADMIN)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'All guides including drafts (admin)' })
  listAll() {
    return this.firstAidService.listAll();
  }

  @Post()
  @Roles(Role.ADMIN)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Author a first-aid guide (admin, markdown content)' })
  @ApiResponse({ status: 409, description: 'Slug already exists.' })
  create(@Body() dto: CreateFirstAidGuideDto) {
    return this.firstAidService.create(dto);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Update / publish a guide (admin)' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateFirstAidGuideDto,
  ) {
    return this.firstAidService.update(id, dto);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @ApiBearerAuth('access-token')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a guide (admin)' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.firstAidService.remove(id);
  }
}
