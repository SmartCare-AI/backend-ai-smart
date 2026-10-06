import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from './prisma.service';

/**
 * Lease-based mutual exclusion for periodic jobs, stored in Postgres
 * (`scheduler_locks`). With several API instances behind a load balancer every
 * instance fires the same @Cron, but only the one that wins the lease does the
 * work. No Redis needed and no connection affinity (unlike advisory locks,
 * which break with a connection pool).
 *
 * The lease expires on its own, so a crashed instance never blocks the job
 * for longer than `ttlMs`.
 */
@Injectable()
export class SchedulerLockService {
  private readonly logger = new Logger(SchedulerLockService.name);
  /** Unique per process, so we only ever release our own lease. */
  private readonly owner = randomUUID();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Runs `fn` only if this instance acquires the named lease. Returns false
   * when another instance holds it (the run is simply skipped).
   */
  async runExclusive(
    name: string,
    ttlMs: number,
    fn: () => Promise<void>,
  ): Promise<boolean> {
    if (!(await this.acquire(name, ttlMs))) return false;
    try {
      await fn();
    } finally {
      await this.release(name).catch((err: Error) =>
        this.logger.warn(`Releasing lock "${name}" failed: ${err.message}`),
      );
    }
    return true;
  }

  private async acquire(name: string, ttlMs: number): Promise<boolean> {
    const until = new Date(Date.now() + ttlMs);
    // One atomic statement: insert the lease, or take it over only if it has
    // expired. RETURNING yields a row exactly when we won.
    const rows = await this.prisma.$queryRaw<{ name: string }[]>`
      INSERT INTO "scheduler_locks" ("name", "lockedUntil", "owner")
      VALUES (${name}, ${until}, ${this.owner})
      ON CONFLICT ("name") DO UPDATE
        SET "lockedUntil" = EXCLUDED."lockedUntil", "owner" = EXCLUDED."owner"
        WHERE "scheduler_locks"."lockedUntil" < NOW()
      RETURNING "name"`;
    return rows.length === 1;
  }

  private async release(name: string): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE "scheduler_locks" SET "lockedUntil" = NOW()
      WHERE "name" = ${name} AND "owner" = ${this.owner}`;
  }
}
