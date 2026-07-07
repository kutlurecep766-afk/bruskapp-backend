import { Module } from '@nestjs/common'
import { BullModule } from '@nestjs/bullmq'
import { MarketplaceQueueService } from './marketplace-queue.service'
import { MarketplaceQueueWorker } from './marketplace-queue.worker'

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'marketplace-sync',
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: { age: 3600 },
        removeOnFail: { age: 86400 },
      },
    }),
  ],
  providers: [MarketplaceQueueService, MarketplaceQueueWorker],
  exports: [MarketplaceQueueService],
})
export class MarketplaceQueueModule {}
