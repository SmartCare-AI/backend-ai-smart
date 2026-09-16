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
import { PaginationDto } from '../common/dto/pagination.dto';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import {
  CreateChatDto,
  GetMessagesDto,
  SendMessageDto,
} from './dto/chat.dtos';

@ApiTags('Chat')
@ApiBearerAuth('access-token')
@Controller('chats')
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly chatGateway: ChatGateway,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Open (or reuse) a direct chat',
    description:
      'Allowed pairs: doctor ↔ patient they treat, caregiver ↔ their patient, admin ↔ anyone. Returns the existing chat if one is already open between the two users. Real-time messaging happens over Socket.IO — see the connection guide in this tag description.',
  })
  @ApiResponse({ status: 201, description: 'The chat with its participants.' })
  @ApiResponse({ status: 403, description: 'This user pair cannot chat.' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateChatDto) {
    return this.chatService.createDirectChat(user, dto);
  }

  @Get('my')
  @ApiOperation({
    summary: 'My chats with last message and unread count',
  })
  listMine(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PaginationDto,
  ) {
    return this.chatService.listMyChats(
      user.id,
      query.page ?? 1,
      query.limit ?? 20,
    );
  }

  @Get(':id/messages')
  @ApiOperation({
    summary: 'Message history (newest first, cursor pagination)',
    description: 'Pass nextCursor from the previous page to scroll back in time.',
  })
  messages(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: GetMessagesDto,
  ) {
    return this.chatService.getMessages(
      user.id,
      id,
      query.cursor,
      query.limit ?? 30,
    );
  }

  @Post(':id/messages')
  @ApiOperation({
    summary: 'Send a message (REST fallback)',
    description:
      'Prefer the Socket.IO "chat:send" event. Messages sent here are still delivered to connected sockets in real time, and offline participants get a push.',
  })
  async send(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SendMessageDto,
  ) {
    const message = await this.chatService.sendMessage(user.id, id, dto);
    await this.chatGateway.dispatchMessage(id, message);
    return message;
  }

  @Patch(':id/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark a chat as read (clears the unread badge)',
    description:
      'Also flips the other side’s messages to READ with a ReadAt timestamp (ERD Message.Status).',
  })
  markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.chatService.markRead(user.id, id);
  }

  @Patch(':id/leave')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Leave a conversation',
    description: 'ERD ChatParticipant.Status LEFT — stops delivery to this user.',
  })
  leave(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.chatService.leave(user.id, id);
  }

  @Delete('messages/:messageId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete one of my messages (soft delete)',
    description: 'ERD Message.Status DELETED — the row is retained, the text is hidden.',
  })
  @ApiResponse({ status: 403, description: 'Not the sender.' })
  deleteMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('messageId', ParseIntPipe) messageId: number,
  ) {
    return this.chatService.deleteMessage(user.id, messageId);
  }
}
