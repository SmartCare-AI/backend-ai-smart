import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CareLinkStatus,
  ChatStatus,
  ChatType,
  MessageStatus,
  ParticipantStatus,
  Role,
  User,
  UserStatus,
} from '@prisma/client';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { USER_NAME_INCLUDE, displayName } from '../common/utils/user-name.util';
import { PrismaService } from '../prisma/prisma.service';
import { CreateChatDto, SendMessageDto } from './dto/chat.dtos';

/**
 * ERD #27 Chat / #28 ChatParticipant / #29 Message.
 *
 * Persistence + access rules. Real-time delivery lives in ChatGateway; both
 * the gateway and the REST controller go through this service, so the rules
 * cannot be bypassed.
 *
 * Who may chat with whom (TR-006 privacy rule):
 *   doctor ↔ patient they treat · caregiver ↔ their linked patient · admin ↔ anyone
 */
@Injectable()
export class ChatService {
  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------------------------
  // Chats
  // -------------------------------------------------------------------------

  async createDirectChat(requester: AuthenticatedUser, dto: CreateChatDto) {
    if (dto.otherUserId === requester.id) {
      throw new BadRequestException('Cannot open a chat with yourself.');
    }
    const other = await this.prisma.user.findUnique({
      where: { id: dto.otherUserId },
    });
    if (!other || other.status !== UserStatus.ACTIVE) {
      throw new NotFoundException('User not found.');
    }

    await this.assertCanChat(requester, other);

    if (dto.visitId) {
      const visit = await this.prisma.visit.findUnique({
        where: { id: dto.visitId },
        select: { id: true },
      });
      if (!visit) throw new BadRequestException('visitId does not exist.');
    }

    // Reuse the existing direct chat between these two users.
    const existing = await this.prisma.chat.findFirst({
      where: {
        type: ChatType.DIRECT,
        status: ChatStatus.ACTIVE,
        AND: [
          { participants: { some: { userId: requester.id } } },
          { participants: { some: { userId: other.id } } },
        ],
      },
      include: { participants: true },
    });
    if (existing) return existing;

    return this.prisma.chat.create({
      data: {
        type: dto.visitId ? ChatType.VISIT : ChatType.DIRECT,
        visitId: dto.visitId ?? null,
        participants: {
          create: [{ userId: requester.id }, { userId: other.id }],
        },
      },
      include: { participants: true },
    });
  }

  /** Chat list with the other participant, last message, and unread count. */
  async listMyChats(userId: number, page: number, limit: number) {
    const where = {
      status: ChatStatus.ACTIVE,
      participants: { some: { userId, status: ParticipantStatus.ACTIVE } },
    };
    const [chats, total] = await this.prisma.$transaction([
      this.prisma.chat.findMany({
        where,
        include: {
          participants: {
            include: {
              user: {
                select: {
                  id: true,
                  email: true,
                  avatarUrl: true,
                  role: true,
                  ...USER_NAME_INCLUDE,
                },
              },
            },
          },
          messages: {
            where: { status: { not: MessageStatus.DELETED } },
            orderBy: { sentAt: 'desc' },
            take: 1,
            select: {
              id: true,
              senderId: true,
              messageText: true,
              sentAt: true,
              status: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.chat.count({ where }),
    ]);

    const items = await Promise.all(
      chats.map(async (chat) => {
        const me = chat.participants.find((p) => p.userId === userId);
        const unread = await this.prisma.message.count({
          where: {
            chatId: chat.id,
            status: { not: MessageStatus.DELETED },
            senderId: { not: userId },
            sentAt: me?.lastReadAt ? { gt: me.lastReadAt } : undefined,
          },
        });
        return {
          id: chat.id,
          type: chat.type,
          status: chat.status,
          visitId: chat.visitId,
          others: chat.participants
            .filter((p) => p.userId !== userId)
            .map((p) => ({
              id: p.user.id,
              fullName: displayName(p.user),
              avatarUrl: p.user.avatarUrl,
              role: p.user.role,
              participantStatus: p.status,
            })),
          lastMessage: chat.messages[0] ?? null,
          unread,
        };
      }),
    );
    return { items, total, page, limit };
  }

  /** Message history, newest first, cursor-based for infinite scroll. */
  async getMessages(
    userId: number,
    chatId: number,
    cursor: number | undefined,
    limit: number,
  ) {
    await this.assertParticipant(userId, chatId);
    const rows = await this.prisma.message.findMany({
      where: {
        chatId,
        status: { not: MessageStatus.DELETED },
        ...(cursor ? { id: { lt: cursor } } : {}),
      },
      include: {
        sender: { select: { id: true, email: true, ...USER_NAME_INCLUDE } },
        file: { select: { id: true, url: true, mimeType: true } },
      },
      orderBy: { id: 'desc' },
      take: limit,
    });
    const items = rows.map((m) => ({
      ...m,
      sender: { id: m.sender.id, fullName: displayName(m.sender) },
    }));
    return {
      items,
      nextCursor: items.length === limit ? items[items.length - 1].id : null,
    };
  }

  async sendMessage(userId: number, chatId: number, dto: SendMessageDto) {
    await this.assertParticipant(userId, chatId);
    if (!dto.messageText?.trim() && !dto.fileId) {
      throw new BadRequestException('Message needs text or a file.');
    }
    if (dto.fileId) {
      const file = await this.prisma.fileObject.findUnique({
        where: { id: dto.fileId },
        select: { ownerId: true },
      });
      if (!file || file.ownerId !== userId) {
        throw new BadRequestException('fileId must be a file you uploaded.');
      }
    }
    const message = await this.prisma.message.create({
      data: {
        chatId,
        senderId: userId,
        messageText: dto.messageText?.trim() ?? '',
        fileId: dto.fileId ?? null,
      },
      include: {
        sender: { select: { id: true, email: true, ...USER_NAME_INCLUDE } },
        file: { select: { id: true, url: true, mimeType: true } },
      },
    });
    return {
      ...message,
      sender: { id: message.sender.id, fullName: displayName(message.sender) },
    };
  }

  /**
   * Marks the chat read for this participant and flips the other side's
   * messages to READ (ERD Message.Status / Message.ReadAt).
   */
  async markRead(userId: number, chatId: number) {
    const participant = await this.assertParticipant(userId, chatId);
    const readAt = new Date();
    await this.prisma.$transaction([
      this.prisma.chatParticipant.update({
        where: { id: participant.id },
        data: { lastReadAt: readAt },
      }),
      this.prisma.message.updateMany({
        where: {
          chatId,
          senderId: { not: userId },
          readAt: null,
          status: { not: MessageStatus.DELETED },
        },
        data: { readAt, status: MessageStatus.READ },
      }),
    ]);
    return { chatId, readAt };
  }

  /** ERD ChatParticipant.Status LEFT — stop receiving this conversation. */
  async leave(userId: number, chatId: number) {
    const participant = await this.assertParticipant(userId, chatId);
    await this.prisma.chatParticipant.update({
      where: { id: participant.id },
      data: { status: ParticipantStatus.LEFT },
    });
    return { chatId, left: true };
  }

  /** ERD Message.Status DELETED — soft delete, sender only. */
  async deleteMessage(userId: number, messageId: number) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { id: true, senderId: true, status: true },
    });
    if (!message || message.status === MessageStatus.DELETED) {
      throw new NotFoundException('Message not found.');
    }
    if (message.senderId !== userId) {
      throw new ForbiddenException('You can only delete your own messages.');
    }
    return this.prisma.message.update({
      where: { id: messageId },
      data: { status: MessageStatus.DELETED },
    });
  }

  // -------------------------------------------------------------------------
  // Shared helpers (also used by the gateway)
  // -------------------------------------------------------------------------

  async assertParticipant(userId: number, chatId: number) {
    const participant = await this.prisma.chatParticipant.findUnique({
      where: { chatId_userId: { chatId, userId } },
    });
    if (!participant || participant.status !== ParticipantStatus.ACTIVE) {
      throw new ForbiddenException('You are not a participant of this chat.');
    }
    return participant;
  }

  async participantUserIds(chatId: number): Promise<number[]> {
    const rows = await this.prisma.chatParticipant.findMany({
      where: { chatId, status: ParticipantStatus.ACTIVE },
      select: { userId: true },
    });
    return rows.map((r) => r.userId);
  }

  // -------------------------------------------------------------------------

  private async assertCanChat(requester: AuthenticatedUser, other: User) {
    if (requester.role === Role.ADMIN || other.role === Role.ADMIN) return;

    const pair = new Set([requester.role, other.role]);
    if (pair.has(Role.DOCTOR) && pair.has(Role.PATIENT)) {
      const doctorUserId =
        requester.role === Role.DOCTOR ? requester.id : other.id;
      const patientUserId =
        requester.role === Role.PATIENT ? requester.id : other.id;
      // BR-004 makes every visit hang off an appointment, so an appointment
      // between the two IS the treating relationship.
      const treating = await this.prisma.doctorProfile.findFirst({
        where: {
          userId: doctorUserId,
          appointments: { some: { patient: { userId: patientUserId } } },
        },
        select: { id: true },
      });
      if (treating) return;
      throw new ForbiddenException(
        'Chat requires a treating relationship (book an appointment first).',
      );
    }

    if (pair.has(Role.CAREGIVER) && pair.has(Role.PATIENT)) {
      const caregiverUserId =
        requester.role === Role.CAREGIVER ? requester.id : other.id;
      const patientUserId =
        requester.role === Role.PATIENT ? requester.id : other.id;
      const link = await this.prisma.patientCaregiver.findFirst({
        where: {
          status: CareLinkStatus.ACTIVE,
          caregiver: { userId: caregiverUserId },
          patient: { userId: patientUserId },
        },
        select: { id: true },
      });
      if (link) return;
      throw new ForbiddenException('No active caregiver link with this patient.');
    }

    throw new ForbiddenException('This user pair cannot open a chat.');
  }
}
