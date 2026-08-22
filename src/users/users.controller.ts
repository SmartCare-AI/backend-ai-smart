import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { MessageResponseDto } from '../common/dto/message-response.dto';
import { MAX_AVATAR_SIZE } from '../uploads/uploads.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { CreateDoctorProfileDto } from './dto/create-doctor-profile.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UploadAvatarDto } from './dto/upload-avatar.dto';
import { UserEntity } from './entities/user.entity';
import { ProfilesService } from './profiles.service';
import { UsersService } from './users.service';

@ApiTags('Users')
@ApiBearerAuth('access-token')
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly profilesService: ProfilesService,
  ) {}

  @Post(':id/doctor-profile')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Promote a user to DOCTOR (admin only)',
    description:
      'Sets the role to DOCTOR and creates/updates the doctor profile with license details. Admin-created doctors are marked license-verified.',
  })
  @ApiResponse({ status: 201, type: UserEntity })
  @ApiResponse({ status: 403, description: 'Requires ADMIN role.' })
  @ApiResponse({ status: 404, description: 'User not found.' })
  @ApiResponse({ status: 409, description: 'License number already in use.' })
  promoteToDoctor(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateDoctorProfileDto,
  ) {
    return this.profilesService.promoteToDoctor(id, dto);
  }

  @Get('me')
  @ApiOperation({ summary: 'Get my profile' })
  @ApiResponse({ status: 200, type: UserEntity })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token.' })
  getProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.getProfile(user.id);
  }

  @Patch('me')
  @ApiOperation({
    summary: 'Edit my profile',
    description: 'Partial update — send only the fields you want to change.',
  })
  @ApiResponse({ status: 200, type: UserEntity })
  updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.usersService.updateProfile(user.id, dto);
  }

  @Put('me/avatar')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_AVATAR_SIZE } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload my avatar (real file upload)',
    description:
      'Uploads the image through the Uploads service and sets it as the profile picture. jpeg/png/webp, max 5 MB.',
  })
  @ApiResponse({ status: 200, type: UserEntity })
  @ApiResponse({ status: 400, description: 'Not an image or too large.' })
  updateAvatar(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File,
    @Body() _dto: UploadAvatarDto,
  ) {
    return this.usersService.updateAvatar(user.id, file);
  }

  @Patch('me/password')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Change my password',
    description:
      'Requires the current password. All refresh tokens are revoked, logging out other devices.',
  })
  @ApiResponse({ status: 200, type: MessageResponseDto })
  @ApiResponse({ status: 401, description: 'Current password is incorrect.' })
  changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.usersService.changePassword(user.id, dto);
  }
}
