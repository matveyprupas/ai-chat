import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Command, Ctx, Start, Update, On, Message } from 'nestjs-telegraf';
import { Context } from 'telegraf';
import { OrderStateService } from '../ai/order-state.service';
import type { BufferJobCustomer } from '../queue/message-buffer.types';
import { MessageBufferService } from '../queue/message-buffer.service';

/**
 * Routes customer text/photo into the debounce buffer.
 * Commands starting with `/` are not buffered (`/start`, `/new` handled separately).
 */
@Update()
export class TelegramUpdate {
  private readonly logger = new Logger(TelegramUpdate.name);
  private readonly tenantId: string;

  constructor(
    private readonly messageBuffer: MessageBufferService,
    private readonly orderState: OrderStateService,
    config: ConfigService,
  ) {
    const tenantId = config.get<string>('TENANT_ID')?.trim();
    if (!tenantId) {
      throw new Error('TENANT_ID is required (UUID used in Redis order keys)');
    }
    this.tenantId = tenantId;
  }

  @Start()
  async onStart(@Ctx() ctx: Context) {
    const name = ctx.from?.first_name ?? 'there';
    await ctx.reply(
      `Привет, ${name}! Бот AI Order Intake запущен.\nПиши текстом или кидай фото — отвечу после короткой паузы (debounce).`,
    );
  }

  @Command('new')
  async onNew(@Ctx() ctx: Context) {
    const chatId = ctx.chat?.id;
    if (chatId == null) {
      return;
    }

    await this.orderState.reset(this.tenantId, String(chatId));
    this.logger.debug(`reset order state chat=${chatId}`);
    await ctx.reply(
      'Начали новый заказ. Предыдущие детали сброшены — пиши, что нужно.',
    );
  }

  @On('text')
  async onText(@Ctx() ctx: Context, @Message('text') text: string) {
    if (text.startsWith('/')) {
      return;
    }

    const chatId = ctx.chat?.id;
    const messageId = ctx.message?.message_id;
    const customer = customerFromCtx(ctx);
    if (chatId == null || messageId == null || customer == null) {
      return;
    }

    this.logger.debug(`buffer text chat=${chatId} messageId=${messageId}`);
    await this.messageBuffer.enqueue(
      String(chatId),
      {
        type: 'text',
        text,
        messageId,
        at: Date.now(),
      },
      customer,
    );
  }

  @On('photo')
  async onPhoto(@Ctx() ctx: Context) {
    const message = ctx.message;
    if (!message || !('photo' in message) || !message.photo?.length) {
      return;
    }

    const chatId = ctx.chat?.id;
    const messageId = message.message_id;
    const customer = customerFromCtx(ctx);
    if (chatId == null || customer == null) {
      return;
    }

    // Telegram sends sizes ascending; last entry is the largest.
    const largest = message.photo[message.photo.length - 1];
    const caption = message.caption ?? null;

    this.logger.debug(`buffer photo chat=${chatId} messageId=${messageId}`);
    await this.messageBuffer.enqueue(
      String(chatId),
      {
        type: 'photo',
        fileId: largest.file_id,
        caption,
        messageId,
        at: Date.now(),
      },
      customer,
    );
  }
}

function customerFromCtx(ctx: Context): BufferJobCustomer | null {
  const from = ctx.from;
  if (from == null) {
    return null;
  }

  return {
    telegramId: String(from.id),
    username: from.username,
    firstName: from.first_name,
  };
}
