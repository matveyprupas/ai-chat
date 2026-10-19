import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import Redis from 'ioredis';
import { InjectBot } from 'nestjs-telegraf';
import { Telegraf } from 'telegraf';
import { OrderAgentService } from '../ai/order-agent.service';
import type { OrderCustomer } from '../ai/order-state';
import {
  type BufferedMessage,
  type BufferJobCustomer,
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
    private readonly orderAgent: OrderAgentService,
  ) {
    super();
  }

  async process(job: Job<BufferJobData>): Promise<void> {
    const { tenantId, chatId, customer } = job.data;
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

      await this.bot.telegram.sendChatAction(chatId, 'typing');
      const reply = await this.orderAgent.processFlush({
        tenantId,
        chatId,
        messages,
        customer: toOrderCustomer(customer),
      });
      await this.bot.telegram.sendMessage(chatId, reply);
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
}

function toOrderCustomer(customer: BufferJobCustomer): OrderCustomer {
  return {
    telegramId: customer.telegramId,
    username: customer.username,
    name: customer.firstName,
  };
}
