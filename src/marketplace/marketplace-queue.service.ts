import { Injectable, OnModuleInit, Logger } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bullmq'
import { Queue } from 'bullmq'

@Injectable()
export class MarketplaceQueueService implements OnModuleInit {
  private readonly logger = new Logger(MarketplaceQueueService.name)

  constructor(
    @InjectQueue('marketplace-sync') private readonly syncQueue: Queue,
  ) {}

  async onModuleInit() {
    await this.setupHepsiburadaPollAll()
  }

  private async setupHepsiburadaPollAll() {
    const schedulers = await this.syncQueue.getJobSchedulers()
    const existing = schedulers.find(j => j.name === 'hbs-poll-all')
    if (existing) {
      this.logger.log('Hepsiburada poll scheduler zaten var')
      return
    }
    await this.syncQueue.upsertJobScheduler(
      'hbs-poll-all',
      { every: 300000 },
      { name: 'hbs-poll-all', data: {} },
    )
    this.logger.log('Hepsiburada poll scheduler olusturuldu (5dk)')
  }

  async addSyncOrders(platform: string, tenantId: string) {
    await this.syncQueue.add('sync-orders', { platform, tenantId }, {
      jobId: `orders:${tenantId}:${platform}`,
      attempts: 5,
      backoff: { type: 'exponential', delay: 3000 },
    })
  }

  async addSyncProducts(platform: string, tenantId: string) {
    await this.syncQueue.add('sync-products', { platform, tenantId }, {
      jobId: `products:${tenantId}:${platform}`,
      attempts: 5,
      backoff: { type: 'exponential', delay: 5000 },
    })
  }
}
