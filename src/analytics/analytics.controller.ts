import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { AnalyticsService } from './analytics.service';
import { Roles } from '../common/decorators/roles.decorator';
import { WindowQueryDto } from './dto/window-query.dto';

/**
 * Hospital dashboard — read-only aggregates. HOSPITAL_ADMIN and ADMIN only;
 * no patient-level data is exposed, only counts and rates.
 */
@ApiTags('Analytics')
@ApiBearerAuth('access-token')
@Roles(Role.HOSPITAL_ADMIN, Role.ADMIN)
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('overview')
  @ApiOperation({
    summary: 'Headline numbers: users, appointments, visits, alerts, adherence',
  })
  @ApiQuery({ name: 'days', required: false, example: 30 })
  overview(@Query() query: WindowQueryDto) {
    return this.analyticsService.overview(query.days);
  }

  @Get('doctor-load')
  @ApiOperation({
    summary: 'Appointments & visits per doctor (busiest first)',
  })
  @ApiQuery({ name: 'days', required: false, example: 30 })
  doctorLoad(@Query() query: WindowQueryDto) {
    return this.analyticsService.doctorLoad(query.days);
  }

  @Get('adherence-by-department')
  @ApiOperation({
    summary: 'Medication adherence score per department',
    description:
      'Doses are attributed to the department of the prescribing doctor.',
  })
  @ApiQuery({ name: 'days', required: false, example: 30 })
  adherenceByDepartment(@Query() query: WindowQueryDto) {
    return this.analyticsService.adherenceByDepartment(query.days);
  }

  @Get('readmissions')
  @ApiOperation({
    summary: 'Readmission rate — patients back within 30 days of a visit',
  })
  @ApiQuery({ name: 'days', required: false, example: 90 })
  readmissions(@Query() query: WindowQueryDto) {
    return this.analyticsService.readmissions(query.days);
  }
}
