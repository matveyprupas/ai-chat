import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);
  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  logger.log(`HTTP listening on http://localhost:${port}`);
  logger.log(
    process.env.TELEGRAM_BOT_TOKEN?.trim()
      ? 'Telegram bot: polling enabled'
      : 'Telegram bot: disabled (set TELEGRAM_BOT_TOKEN in be/.env)',
  );
}
void bootstrap();
