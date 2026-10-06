import {
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
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
import { Roles } from '../common/decorators/roles.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';
import { PatientsService } from './patients.service';

@ApiTags('Care Team')
@ApiBearerAuth('access-token')
@Roles(Role.PATIENT)
@Controller('patients/me')
export class PatientsController {
  constructor(private readonly patients: PatientsService) {}

  @Get('care-team')
  @ApiOperation({
    summary: 'Doctors who can read my record (patient)',
    description:
      'A doctor gets access when they confirm my appointment; each visit extends it to 12 months after the visit. Includes the expiry, last visit and next appointment per doctor.',
  })
  careTeam(@CurrentUser() user: AuthenticatedUser) {
    return this.patients.careTeam(user);
  }

  @Delete('care-team/:id')
  @ApiOperation({
    summary: "Remove a doctor's access to my record (patient)",
    description:
      'Immediate. The doctor also stops receiving my alerts. A future booking they confirm grants access again.',
  })
  @ApiResponse({
    status: 409,
    description: 'An appointment with this doctor is still upcoming.',
  })
  revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.patients.revokeCare(user, id);
  }

  @Get('access-history')
  @ApiOperation({
    summary: 'Who opened my record (patient)',
    description:
      'Every access by a doctor, caregiver or admin, including refused attempts (outcome DENIED). Repeated reads by the same person are grouped per 5 minutes.',
  })
  accessHistory(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PaginationDto,
  ) {
    return this.patients.accessHistory(user, query);
  }
}
