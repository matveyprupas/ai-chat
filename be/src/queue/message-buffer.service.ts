import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import {
  BUFFER_TTL_SEC,
  type BufferedMessage,
  type BufferJobData,
  DEBOUNCE_MS,
  MESSAGE_BUFFER_QUEUE,
} from './message-buffer.types';
import { REDIS_CLIENT } from './redis.module';

@Injectable()
export class MessageBufferService {
  private readonly tenantId: string;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @InjectQueue(MESSAGE_BUFFER_QUEUE)
    private readonly queue: Queue<BufferJobData>,
    config: ConfigService,
  ) {
    const tenantId = config.get<string>('TENANT_ID')?.trim();
    if (!tenantId) {
      throw new Error('TENANT_ID is required (UUID used in Redis buffer keys)');
    }
    this.tenantId = tenantId;
  }

  async enqueue(chatId: string, item: BufferedMessage): Promise<void> {
    const jobId = `${this.tenantId}_${chatId}`;
    const key = `buffer:${this.tenantId}:${chatId}`;

    await this.redis
      .multi()
      .rpush(key, JSON.stringify(item))
      .expire(key, BUFFER_TTL_SEC)
      .exec();

    // Remove any pending delayed job so the debounce timer resets.
    await this.queue.remove(jobId);
    await this.queue.add(
      'flush',
      { tenantId: this.tenantId, chatId },
      {
        jobId,
        delay: DEBOUNCE_MS,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }
}
