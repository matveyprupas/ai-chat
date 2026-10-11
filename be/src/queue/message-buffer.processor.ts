import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import Redis from 'ioredis';
import { InjectBot } from 'nestjs-telegraf';
import { Telegraf } from 'telegraf';
import {
  type BufferedMessage,
  type BufferJobData,
  MESSAGE_BUFFER_QUEUE,
} from './message-buffer.types';
import { REDIS_CLIENT } from './redis.module';

@Processor(MESSAGE_BUFFER_QUEUE)
export class MessageBufferProcessor extends WorkerHost {
  private readonly logger = new Logger(MessageBufferProcessor.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @InjectBot() private readonly bot: Telegraf,
  ) {
    super();
  }

  async process(job: Job<BufferJobData>): Promise<void> {
    const { tenantId, chatId } = job.data;
    const key = `buffer:${tenantId}:${chatId}`;

    try {
      const results = await this.redis
        .multi()
        .lrange(key, 0, -1)
        .del(key)
        .exec();

      const raw = (results?.[0]?.[1] as string[] | undefined) ?? [];

      if (raw.length === 0) {
        return;
      }

      const messages = raw.map((entry) => JSON.parse(entry) as BufferedMessage);
      const summary = this.buildSummary(messages);

      await this.bot.telegram.sendChatAction(chatId, 'typing');
      await this.bot.telegram.sendMessage(chatId, summary);
    } catch (error) {
      this.logger.error(
        `Failed to flush buffer for chat=${chatId}`,
        error instanceof Error ? error.stack : String(error),
      );
      try {
        await this.bot.telegram.sendMessage(
          chatId,
          'Не удалось обработать сообщения. Попробуй ещё раз.',
        );
      } catch (sendError) {
        this.logger.error(
          `Failed to send error reply to chat=${chatId}`,
          sendError instanceof Error ? sendError.stack : String(sendError),
        );
      }
      throw error;
    }
  }

  private buildSummary(messages: BufferedMessage[]): string {
    return messages
      .map((message, index) => {
        const n = index + 1;
        if (message.type === 'text') {
          return `${n}. ${message.text}`;
        }
        return message.caption
          ? `${n}. [фото] ${message.caption}`
          : `${n}. [фото]`;
      })
      .join('\n');
  }
}
