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
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { MessageResponseDto } from '../common/dto/message-response.dto';
import {
  RegisterDeviceTokenDto,
  RemoveDeviceTokenDto,
} from './dto/register-device-token.dto';
import { ListNotificationsDto } from './dto/list-notifications.dto';
import {
  NotificationEntity,
  PaginatedNotificationsEntity,
} from './entities/notification.entity';
import { NotificationsService } from './notifications.service';

@ApiTags('Notifications')
@ApiBearerAuth('access-token')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post('tokens')
  @ApiOperation({
    summary: 'Register this device for push notifications',
    description:
      'The app calls this after login with its FCM token. Same token re-registered by another account is reassigned (shared devices).',
  })
  @ApiResponse({ status: 201, type: MessageResponseDto })
  registerToken(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RegisterDeviceTokenDto,
  ) {
    return this.notificationsService.registerToken(
      user.id,
      dto.token,
      dto.platform,
    );
  }

  @Delete('tokens')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Unregister a device (call on logout)',
  })
  @ApiResponse({ status: 200, type: MessageResponseDto })
  removeToken(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RemoveDeviceTokenDto,
  ) {
    return this.notificationsService.removeToken(user.id, dto.token);
  }

  @Get()
  @ApiOperation({ summary: 'My notification feed (paginated, newest first)' })
  @ApiResponse({ status: 200, type: PaginatedNotificationsEntity })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListNotificationsDto,
  ) {
    return this.notificationsService.list(
      user.id,
      query.page ?? 1,
      query.limit ?? 20,
      query.unread ?? false,
    );
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Unread badge counter' })
  @ApiResponse({ status: 200, schema: { example: { count: 3 } } })
  unreadCount(@CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.unreadCount(user.id);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark one notification as read' })
  @ApiResponse({ status: 200, type: NotificationEntity })
  @ApiResponse({ status: 404, description: 'Not found or not yours.' })
  markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.notificationsService.markRead(user.id, id);
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Mark all my notifications as read' })
  @ApiResponse({ status: 200, type: MessageResponseDto })
  markAllRead(@CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.markAllRead(user.id);
  }
}
