import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ChatType, Role, User } from '@prisma/client';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { CreateChatDto, SendMessageDto } from './dto/chat.dtos';

/**
 * Chat persistence + access rules. Real-time delivery lives in ChatGateway;
 * both the gateway and the REST controller go through this service, so the
 * rules cannot be bypassed.
 *
 * Who may chat with whom (privacy rule):
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
    if (!other || !other.isActive) throw new NotFoundException('User not found.');

    await this.assertCanChat(requester, other);

    // Reuse the existing direct chat between these two users.
    const existing = await this.prisma.chat.findFirst({
      where: {
        type: ChatType.DIRECT,
        isActive: true,
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
    const where = { isActive: true, participants: { some: { userId } } };
    const [chats, total] = await this.prisma.$transaction([
      this.prisma.chat.findMany({
        where,
        include: {
          participants: {
            include: {
              user: {
                select: { id: true, firstName: true, lastName: true, avatarUrl: true, role: true },
              },
            },
          },
          messages: {
            where: { deletedAt: null },
            orderBy: { sentAt: 'desc' },
            take: 1,
            select: { id: true, senderId: true, text: true, sentAt: true },
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
            deletedAt: null,
            senderId: { not: userId },
            sentAt: me?.lastReadAt ? { gt: me.lastReadAt } : undefined,
          },
        });
        return {
          id: chat.id,
          type: chat.type,
          visitId: chat.visitId,
          others: chat.participants
            .filter((p) => p.userId !== userId)
            .map((p) => p.user),
          lastMessage: chat.messages[0] ?? null,
          unread,
        };
      }),
    );
    return { items, total, page, limit };
  }

  /** Message history, newest first, cursor-based for infinite scroll. */
  async getMessages(userId: number, chatId: number, cursor: number | undefined, limit: number) {
    await this.assertParticipant(userId, chatId);
    const items = await this.prisma.message.findMany({
      where: {
        chatId,
        deletedAt: null,
        ...(cursor ? { id: { lt: cursor } } : {}),
      },
      include: {
        sender: { select: { id: true, firstName: true, lastName: true } },
        file: { select: { id: true, url: true, mimeType: true } },
      },
      orderBy: { id: 'desc' },
      take: limit,
    });
    return {
      items,
      nextCursor: items.length === limit ? items[items.length - 1].id : null,
    };
  }

  async sendMessage(userId: number, chatId: number, dto: SendMessageDto) {
    await this.assertParticipant(userId, chatId);
    if (!dto.text?.trim() && !dto.fileId) {
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
    return this.prisma.message.create({
      data: {
        chatId,
        senderId: userId,
        text: dto.text?.trim() ?? '',
        fileId: dto.fileId ?? null,
      },
      include: {
        sender: { select: { id: true, firstName: true, lastName: true } },
        file: { select: { id: true, url: true, mimeType: true } },
      },
    });
  }

  async markRead(userId: number, chatId: number) {
    const participant = await this.assertParticipant(userId, chatId);
    await this.prisma.chatParticipant.update({
      where: { id: participant.id },
      data: { lastReadAt: new Date() },
    });
    return { chatId, readAt: new Date() };
  }

  // -------------------------------------------------------------------------
  // Shared helpers (also used by the gateway)
  // -------------------------------------------------------------------------

  async assertParticipant(userId: number, chatId: number) {
    const participant = await this.prisma.chatParticipant.findUnique({
      where: { chatId_userId: { chatId, userId } },
    });
    if (!participant) {
      throw new ForbiddenException('You are not a participant of this chat.');
    }
    return participant;
  }

  async participantUserIds(chatId: number): Promise<number[]> {
    const rows = await this.prisma.chatParticipant.findMany({
      where: { chatId },
      select: { userId: true },
    });
    return rows.map((r) => r.userId);
  }

  // -------------------------------------------------------------------------

  private async assertCanChat(requester: AuthenticatedUser, other: User) {
    if (requester.role === Role.ADMIN || other.role === Role.ADMIN) return;

    const pair = new Set([requester.role, other.role]);
    if (pair.has(Role.DOCTOR) && pair.has(Role.PATIENT)) {
      const doctorUserId = requester.role === Role.DOCTOR ? requester.id : other.id;
      const patientUserId = requester.role === Role.PATIENT ? requester.id : other.id;
      const treating = await this.prisma.doctorProfile.findFirst({
        where: {
          userId: doctorUserId,
          OR: [
            { appointments: { some: { patient: { userId: patientUserId } } } },
            { visits: { some: { patient: { userId: patientUserId } } } },
          ],
        },
        select: { id: true },
      });
      if (treating) return;
      throw new ForbiddenException(
        'Chat requires a treating relationship (book an appointment first).',
      );
    }

    if (pair.has(Role.CAREGIVER) && pair.has(Role.PATIENT)) {
      const caregiverUserId = requester.role === Role.CAREGIVER ? requester.id : other.id;
      const patientUserId = requester.role === Role.PATIENT ? requester.id : other.id;
      const link = await this.prisma.patientCaregiver.findFirst({
        where: {
          isActive: true,
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
