import { DynamicModule, Logger, Module } from '@nestjs/common';
import { TelegrafModule } from 'nestjs-telegraf';
import { TelegramUpdate } from './telegram.update';

@Module({})
export class TelegramModule {
  private static readonly logger = new Logger(TelegramModule.name);

  /**
   * Long-polling Telegraf when TELEGRAM_BOT_TOKEN is set.
   * Without a token the HTTP API still boots (infra-only).
   */
  static forRoot(): DynamicModule {
    const token = process.env.TELEGRAM_BOT_TOKEN?.trim();

    if (!token) {
      this.logger.warn(
        'TELEGRAM_BOT_TOKEN is empty — Telegram bot disabled. Set it in be/.env (BotFather).',
      );
      return {
        module: TelegramModule,
      };
    }

    return {
      module: TelegramModule,
      imports: [
        TelegrafModule.forRoot({
          token,
          // omit launchOptions → default long polling (local dev)
        }),
      ],
      providers: [TelegramUpdate],
    };
  }
}
