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
import { UserEntity } from '../users/entities/user.entity';
import { CaregiversService } from './caregivers.service';
import {
  GrantConsentDto,
  InviteCaregiverDto,
  UpdateCaregiverLinkDto,
} from './dto/caregiver.dtos';

@ApiTags('Family Portal')
@ApiBearerAuth('access-token')
@Controller('caregivers')
export class CaregiversController {
  constructor(private readonly caregivers: CaregiversService) {}

  @Post('invite')
  @Roles(Role.PATIENT)
  @ApiOperation({
    summary: 'Invite a family member to my care circle (patient)',
    description:
      'Emails the invitee (and pushes a notification if they already have an account). They accept in the app after signing in with that email. Max 2 companions including pending invitations; invitations expire after 7 days.',
  })
  @ApiResponse({ status: 201, description: 'The pending invitation.' })
  @ApiResponse({
    status: 409,
    description: 'Already linked, already invited, or the circle is full.',
  })
  invite(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: InviteCaregiverDto,
  ) {
    return this.caregivers.invite(user, dto);
  }

  @Get('my')
  @Roles(Role.PATIENT)
  @ApiOperation({
    summary: 'My care circle (patient): caregivers + pending invitations',
  })
  myCircle(@CurrentUser() user: AuthenticatedUser) {
    return this.caregivers.myCircle(user);
  }

  @Get('patients')
  @Roles(Role.CAREGIVER)
  @ApiOperation({
    summary: 'Patients I follow (caregiver)',
    description:
      'Each item has the patient profile id to use with /vitals, /alerts, /appointments…, the effective `permissions` (link level + extra consents) and the number of open alerts.',
  })
  myPatients(@CurrentUser() user: AuthenticatedUser) {
    return this.caregivers.myPatients(user);
  }

  @Patch(':linkId')
  @Roles(Role.PATIENT)
  @ApiOperation({
    summary: "Change a caregiver's permission level or end date (patient)",
  })
  updateLink(
    @CurrentUser() user: AuthenticatedUser,
    @Param('linkId', ParseIntPipe) linkId: number,
    @Body() dto: UpdateCaregiverLinkDto,
  ) {
    return this.caregivers.updateLink(user, linkId, dto);
  }

  @Delete('invitations/:id')
  @Roles(Role.PATIENT)
  @ApiOperation({ summary: 'Cancel a pending invitation (patient)' })
  cancelInvitation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.caregivers.cancelInvitation(user, id);
  }

  @Delete(':linkId')
  @ApiOperation({
    summary: 'Remove a caregiver (patient) or leave a care circle (caregiver)',
    description:
      'Patient → REVOKED, caregiver → ENDED. Extra consents for that caregiver are revoked too. Access stops immediately.',
  })
  removeLink(
    @CurrentUser() user: AuthenticatedUser,
    @Param('linkId', ParseIntPipe) linkId: number,
  ) {
    return this.caregivers.removeLink(user, linkId);
  }
}

@ApiTags('Family Portal')
@ApiBearerAuth('access-token')
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly caregivers: CaregiversService) {}

  @Get('my')
  @ApiOperation({
    summary: 'Care circle invitations sent to my email (any role)',
  })
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.caregivers.myInvitations(user);
  }

  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Accept an invitation',
    description:
      'Creates my caregiver profile (if new) and the link. A patient-only account switches its active role to CAREGIVER; others keep their active role. Returns my updated account.',
  })
  @ApiResponse({ status: 200, type: UserEntity })
  accept(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.caregivers.accept(user, id);
  }

  @Post(':id/decline')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Decline an invitation' })
  decline(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.caregivers.decline(user, id);
  }
}

@ApiTags('Family Portal')
@ApiBearerAuth('access-token')
@Roles(Role.PATIENT)
@Controller('consents')
export class ConsentsController {
  constructor(private readonly caregivers: CaregiversService) {}

  @Post()
  @ApiOperation({
    summary: 'Grant a caregiver an extra permission (patient)',
    description:
      'Adds a permission on top of the caregiver link level, optionally until `expiresAt`. Only members of your care circle.',
  })
  grant(@CurrentUser() user: AuthenticatedUser, @Body() dto: GrantConsentDto) {
    return this.caregivers.grantConsent(user, dto);
  }

  @Get('my')
  @ApiOperation({ summary: 'Consents I have granted (patient)' })
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.caregivers.myConsents(user);
  }

  @Patch(':id/revoke')
  @ApiOperation({ summary: 'Revoke a consent (patient)' })
  revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.caregivers.revokeConsent(user, id);
  }
}
