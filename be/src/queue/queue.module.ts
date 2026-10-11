import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MESSAGE_BUFFER_QUEUE } from './message-buffer.types';
import { MessageBufferService } from './message-buffer.service';
import { RedisModule } from './redis.module';

@Module({
  imports: [
    RedisModule,
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
  providers: [MessageBufferService],
  exports: [BullModule, RedisModule, MessageBufferService],
})
export class QueueModule {}
