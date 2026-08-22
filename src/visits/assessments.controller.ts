import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';
import { CreateAssessmentDto } from './dto/visit.dtos';
import { VisitsService } from './visits.service';

@ApiTags('Assessments')
@ApiBearerAuth('access-token')
@Controller('assessments')
export class AssessmentsController {
  constructor(private readonly visitsService: VisitsService) {}

  @Post()
  @ApiOperation({
    summary: 'Create an assessment',
    description:
      'Patients self-report symptoms (type forced to AI_INITIAL, own profile). Doctors create DOCTOR/FOLLOW_UP assessments for patients they treat.',
  })
  @ApiResponse({ status: 201, description: 'The created assessment.' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateAssessmentDto,
  ) {
    return this.visitsService.createAssessment(user, dto);
  }

  @Get('patients/:patientId')
  @ApiOperation({
    summary: "A patient's assessment history",
    description: 'Access: the patient, treating doctor, or caregiver with VIEW_RECORDS.',
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('patientId', ParseIntPipe) patientId: number,
    @Query() query: PaginationDto,
  ) {
    return this.visitsService.listAssessments(
      user,
      patientId,
      query.page ?? 1,
      query.limit ?? 20,
    );
  }
}
