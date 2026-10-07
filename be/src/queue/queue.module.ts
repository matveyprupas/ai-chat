import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

/** Queue names used by the debounce / AI pipeline (workers come later). */
export const MESSAGE_BUFFER_QUEUE = 'message-buffer';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
        },
      }),
    }),
    BullModule.registerQueue({
      name: MESSAGE_BUFFER_QUEUE,
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
