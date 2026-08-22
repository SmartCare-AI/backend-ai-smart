import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  userId?: number | null;
  /** e.g. "CREATE", "UPDATE", "DELETE", "LOGIN", "REGISTER" */
  action: string;
  entityName: string;
  entityId?: string | null;
  ipAddress?: string | null;
  description?: string | null;
}

/**
 * Compliance trail: who did what, when, from where.
 * Writes are fire-and-forget — an audit failure must never break the
 * actual request, so errors are logged and swallowed here.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  record(entry: AuditEntry): void {
    void this.prisma.auditLog
      .create({
        data: {
          userId: entry.userId ?? null,
          action: entry.action,
          entityName: entry.entityName,
          entityId: entry.entityId ?? null,
          ipAddress: entry.ipAddress ?? null,
          description: entry.description ?? null,
        },
      })
      .catch((err: Error) =>
        this.logger.warn(`Failed to write audit log: ${err.message}`),
      );
  }
}
