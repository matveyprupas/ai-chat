import { Logger } from '@nestjs/common';
import { Ctx, Start, Update, On, Message } from 'nestjs-telegraf';
import { Context } from 'telegraf';
import type { BufferJobCustomer } from '../queue/message-buffer.types';
import { MessageBufferService } from '../queue/message-buffer.service';

/**
 * Routes customer text/photo into the debounce buffer.
 * Commands starting with `/` are not buffered (`/start` handled separately).
 */
@Update()
export class TelegramUpdate {
  private readonly logger = new Logger(TelegramUpdate.name);

  constructor(private readonly messageBuffer: MessageBufferService) {}

  @Start()
  async onStart(@Ctx() ctx: Context) {
    const name = ctx.from?.first_name ?? 'there';
    await ctx.reply(
      `Привет, ${name}! Бот AI Order Intake запущен.\nПиши текстом или кидай фото — отвечу после короткой паузы (debounce).`,
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
