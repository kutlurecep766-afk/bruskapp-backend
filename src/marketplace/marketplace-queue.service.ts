import { Injectable } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bullmq'
import { Queue, JobsOptions } from 'bullmq'

@Injectable()
export class MarketplaceQueueService {
  constructor(
    @InjectQueue('marketplace-sync') private readonly syncQueue: Queue,
  ) {}

  async addSyncOrders(platform: string, tenantId: string) {
    await this.syncQueue.add('sync-orders', { platform, tenantId })
  }

  async addSyncProducts(platform: string, tenantId: string) {
    await this.syncQueue.add('sync-products', { platform, tenantId })
  }

  async addHepsiburadaPollAll() {
    const jobs = await this.syncQueue.getJobSchedulers()
    const existing = jobs.find(j => j.name === 'hbs-poll-all')
    if (existing) return
    await this.syncQueue.upsertJobScheduler(
      'hbs-poll-all',
      { every: 300000 },
      { name: 'hbs-poll-all', data: {} },
    )
  }

  async removeHepsiburadaPollAll() {
    await this.syncQueue.removeJobScheduler('hbs-poll-all')
  }
}
