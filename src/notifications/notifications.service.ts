import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { DevicePlatform, NotificationType } from '@prisma/client';
import type { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUES, QueueService } from '../queues/queue.service';
import { NotificationEntity } from './entities/notification.entity';
import { PushService } from './push.service';

export interface NotifyInput {
  type: NotificationType;
  title: string;
  body: string;
  /** Deep-link payload for the app */
  data?: Record<string, string>;
  alertId?: number;
}

interface DispatchJob {
  userId: number;
  title: string;
  body: string;
  data?: Record<string, string>;
}

/**
 * Single entry point for ALL user-facing notifications:
 *   1. persists the in-app feed row (bell icon),
 *   2. pushes via FCM to every registered device of the user.
 *
 * Push dispatch goes through the queue when Redis is available (retries,
 * doesn't block the request) and runs inline otherwise.
 */
@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueueService,
    private readonly push: PushService,
  ) {}

  onModuleInit() {
    this.queues.process(QUEUES.NOTIFICATIONS, (job: Job) =>
      this.dispatchPush(job.data as DispatchJob),
    );
  }

  // -------------------------------------------------------------------------
  // API for other modules (appointments, alerts, emergency, ...)
  // -------------------------------------------------------------------------

  async notify(userId: number, input: NotifyInput): Promise<void> {
    await this.prisma.notification.create({
      data: {
        userId,
        type: input.type,
        title: input.title,
        body: input.body,
        data: input.data ? JSON.stringify(input.data) : null,
        alertId: input.alertId ?? null,
      },
    });

    const job: DispatchJob = {
      userId,
      title: input.title,
      body: input.body,
      data: input.data,
    };
    const queued = await this.queues.add(QUEUES.NOTIFICATIONS, 'dispatch', job);
    if (!queued) await this.dispatchPush(job);
  }

  async notifyMany(userIds: number[], input: NotifyInput): Promise<void> {
    await Promise.all(userIds.map((id) => this.notify(id, input)));
  }

  // -------------------------------------------------------------------------
  // Device tokens
  // -------------------------------------------------------------------------

  async registerToken(
    userId: number,
    token: string,
    platform: DevicePlatform,
  ): Promise<{ message: string }> {
    // Token may move between accounts (logout/login on shared device) —
    // upsert reassigns it to the current user.
    await this.prisma.deviceToken.upsert({
      where: { token },
      create: { userId, token, platform },
      update: { userId, platform, lastUsedAt: new Date(), revokedAt: null },
    });
    return { message: 'Device registered for push notifications.' };
  }

  async removeToken(userId: number, token: string): Promise<{ message: string }> {
    await this.prisma.deviceToken.updateMany({
      where: { userId, token, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { message: 'Device unregistered.' };
  }

  // -------------------------------------------------------------------------
  // In-app feed
  // -------------------------------------------------------------------------

  async list(userId: number, page: number, limit: number, unread: boolean) {
    const where = { userId, ...(unread ? { readAt: null } : {}) };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.notification.count({ where }),
    ]);
    return {
      items: items.map(NotificationEntity.fromNotification),
      total,
      page,
      limit,
    };
  }

  async unreadCount(userId: number): Promise<{ count: number }> {
    const count = await this.prisma.notification.count({
      where: { userId, readAt: null },
    });
    return { count };
  }

  async markRead(userId: number, id: number): Promise<NotificationEntity> {
    const notification = await this.prisma.notification.findFirst({
      where: { id, userId },
    });
    if (!notification) throw new NotFoundException('Notification not found.');
    const updated = await this.prisma.notification.update({
      where: { id },
      data: { readAt: notification.readAt ?? new Date() },
    });
    return NotificationEntity.fromNotification(updated);
  }

  async markAllRead(userId: number): Promise<{ message: string }> {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { message: 'All notifications marked as read.' };
  }

  // -------------------------------------------------------------------------

  private async dispatchPush(job: DispatchJob): Promise<void> {
    const tokens = await this.prisma.deviceToken.findMany({
      where: { userId: job.userId, revokedAt: null },
      select: { token: true },
    });
    if (tokens.length === 0) return;

    const result = await this.push.sendToTokens(
      tokens.map((t) => t.token),
      { title: job.title, body: job.body, data: job.data },
    );

    // Housekeeping: tokens FCM declared dead get revoked so we stop
    // paying latency for them on every send.
    if (result.invalidTokens.length > 0) {
      await this.prisma.deviceToken.updateMany({
        where: { token: { in: result.invalidTokens } },
        data: { revokedAt: new Date() },
      });
      this.logger.log(`Revoked ${result.invalidTokens.length} dead FCM token(s).`);
    }
  }
}
