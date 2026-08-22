import {
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import type { JobsOptions, Processor } from 'bullmq';
import Redis from 'ioredis';

/** Well-known queue names — one place to avoid typos. */
export const QUEUES = {
  NOTIFICATIONS: 'notifications',
  REMINDERS: 'reminders',
  ESCALATIONS: 'escalations',
} as const;

/**
 * Thin BullMQ wrapper with graceful degradation:
 *
 * - REDIS_URL set   → real queues (delayed jobs, retries, multi-instance).
 * - REDIS_URL empty → `add()` returns false and the CALLER runs the work
 *   inline. Delayed jobs (SOS escalation) genuinely need Redis; callers
 *   fall back to in-process setTimeout — fine for dev, documented for prod.
 *
 * Callers never touch BullMQ directly (Dependency Inversion) — swapping the
 * queue backend later touches only this file.
 */
@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private readonly redisUrl?: string;
  private readonly queues = new Map<string, Queue>();
  private readonly workers: Worker[] = [];

  readonly enabled: boolean;

  constructor(config: ConfigService) {
    this.redisUrl = config.get<string>('REDIS_URL');
    this.enabled = !!this.redisUrl;
    if (!this.enabled) {
      this.logger.warn(
        'REDIS_URL not set — queues disabled; jobs run inline (dev mode). Set REDIS_URL in production.',
      );
    }
  }

  /**
   * Enqueue a job. Returns false when queues are disabled — the caller is
   * then responsible for executing the work inline.
   */
  async add(
    queueName: string,
    jobName: string,
    data: unknown,
    opts?: JobsOptions,
  ): Promise<boolean> {
    if (!this.enabled) return false;
    await this.getQueue(queueName).add(jobName, data, {
      removeOnComplete: 1000,
      removeOnFail: 5000,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      ...opts,
    });
    return true;
  }

  /** Register the worker that processes a queue. No-op when disabled. */
  process(queueName: string, processor: Processor): void {
    if (!this.enabled) return;
    const worker = new Worker(queueName, processor, {
      connection: this.newConnection(),
      concurrency: 5,
    });
    worker.on('failed', (job, err) =>
      this.logger.error(
        `Job ${queueName}/${job?.name ?? '?'} failed: ${err.message}`,
      ),
    );
    this.workers.push(worker);
  }

  private getQueue(name: string): Queue {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new Queue(name, { connection: this.newConnection() });
      this.queues.set(name, queue);
    }
    return queue;
  }

  /** BullMQ requires maxRetriesPerRequest: null on its connections. */
  private newConnection(): Redis {
    return new Redis(this.redisUrl as string, { maxRetriesPerRequest: null });
  }

  async onModuleDestroy() {
    await Promise.all(this.workers.map((w) => w.close()));
    await Promise.all([...this.queues.values()].map((q) => q.close()));
  }
}
