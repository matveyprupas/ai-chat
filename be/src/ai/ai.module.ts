import { Module } from '@nestjs/common';
import { RedisModule } from '../queue/redis.module';
import { OrderAgentService } from './order-agent.service';
import { OrderStateService } from './order-state.service';

@Module({
  imports: [RedisModule],
  providers: [OrderStateService, OrderAgentService],
  exports: [OrderStateService, OrderAgentService],
})
export class AiModule {}
