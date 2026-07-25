import { Module } from '@nestjs/common'
import { BullModule } from '@nestjs/bullmq'
import { AiQueueService } from './ai-queue.service'

@Module({
  imports: [
    BullModule.registerQueue({ name: 'ai-message-processing' }),
  ],
  providers: [AiQueueService],
  exports: [AiQueueService],
})
export class AiQueueModule {}
