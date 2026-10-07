import { Logger } from '@nestjs/common';
import { Ctx, Start, Update, On, Message } from 'nestjs-telegraf';
import { Context } from 'telegraf';

/**
 * Scaffold echo bot — replace with debounce → AI pipeline later.
 * One bot handles both customer chat and confectioner approvals.
 */
@Update()
export class TelegramUpdate {
  private readonly logger = new Logger(TelegramUpdate.name);

  @Start()
  async onStart(@Ctx() ctx: Context) {
    const name = ctx.from?.first_name ?? 'there';
    await ctx.reply(
      `Привет, ${name}! Бот AI Order Intake запущен (scaffold).\nНапиши что угодно — пока отвечаю echo.`,
    );
  }

  @On('text')
  async onText(@Ctx() ctx: Context, @Message('text') text: string) {
    this.logger.debug(`chat=${ctx.chat?.id} text=${text}`);
    if (text.startsWith('/')) {
      return;
    }
    await ctx.reply(`echo: ${text}`);
  }
}
