import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Notification, NotificationType } from '@prisma/client';

export class NotificationEntity {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ enum: NotificationType, example: NotificationType.ALERT })
  type!: NotificationType;

  @ApiProperty({ example: 'Medication reminder' })
  title!: string;

  @ApiProperty({ example: 'Time to take Panadol 500mg.' })
  body!: string;

  @ApiPropertyOptional({
    example: '{"screen":"medications","id":"12"}',
    nullable: true,
    description: 'Deep-link payload (JSON string).',
  })
  data!: string | null;

  @ApiPropertyOptional({ example: null, nullable: true })
  readAt!: Date | null;

  @ApiProperty({ example: '2026-08-20T10:15:00.000Z' })
  createdAt!: Date;

  static fromNotification(n: Notification): NotificationEntity {
    const { userId: _userId, alertId: _alertId, ...safe } = n;
    return Object.assign(new NotificationEntity(), safe);
  }
}

export class PaginatedNotificationsEntity {
  @ApiProperty({ type: [NotificationEntity] })
  items!: NotificationEntity[];

  @ApiProperty({ example: 42 })
  total!: number;

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  limit!: number;
}
