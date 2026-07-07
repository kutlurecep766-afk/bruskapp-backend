import { Injectable, Logger } from '@nestjs/common'
import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Job } from 'bullmq'
import { PrismaService } from '../prisma.service'
import { MarketplaceService } from './marketplace.service'

@Injectable()
@Processor('marketplace-sync')
export class MarketplaceQueueWorker extends WorkerHost {
  private readonly logger = new Logger(MarketplaceQueueWorker.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly marketplaceService: MarketplaceService,
  ) {
    super()
  }

  async process(job: Job<any, any, string>): Promise<any> {
    try {
      switch (job.name) {
        case 'hbs-poll-all':
          return await this.handleHepsiburadaPollAll()
        case 'sync-orders': {
          const { platform, tenantId } = job.data as { platform: string; tenantId: string }
          return await this.handleSyncOrders(platform, tenantId)
        }
        case 'sync-products': {
          const { platform, tenantId } = job.data as { platform: string; tenantId: string }
          return await this.handleSyncProducts(platform, tenantId)
        }
        default:
          this.logger.warn(`Bilinmeyen job tipi: ${job.name}`)
      }
    } catch (e: any) {
      const status = e?.response?.status || e?.status || e?.statusCode
      const tenantInfo = (job.data as any)?.tenantId || 'unknown'
      const platformInfo = (job.data as any)?.platform || 'unknown'

      if (status === 429) {
        this.logger.warn(`[429 Rate Limit] ${platformInfo} tenant=${tenantInfo} job=${job.name} — backoff devrede`)
        throw e
      }

      if (status >= 500 || e instanceof Error) {
        this.logger.error(`Job hatasi: ${job.name} tenant=${tenantInfo} platform=${platformInfo}: ${e.message}`)
      }

      throw e
    }
  }

  private async handleHepsiburadaPollAll() {
    const tenants = await this.prisma.tenant.findMany()
    let polled = 0
    for (const tenant of tenants) {
      const keys = tenant.marketplaceApiKeys as any
      if (!keys?.hepsiburada?.apiKey) continue
      try {
        await this.marketplaceService.getOrders('hepsiburada', tenant.id, 0, 50)
        polled++
      } catch (e: any) {
        const status = e?.response?.status || e?.status
        if (status === 429) {
          this.logger.warn(`Hepsiburada poll 429 (${tenant.slug}) — tenant atlaniyor`)
          continue
        }
        this.logger.warn(`Hepsiburada poll error (${tenant.slug}): ${e.message}`)
      }
    }
    if (polled > 0) this.logger.debug(`Hepsiburada polled ${polled} tenants`)
  }

  private async handleSyncOrders(platform: string, tenantId: string) {
    this.logger.log(`Queue sync-orders: ${platform} / ${tenantId}`)
    await this.marketplaceService.getOrders(platform, tenantId, 0, 50)
  }

  private async handleSyncProducts(platform: string, tenantId: string) {
    this.logger.log(`Queue sync-products: ${platform} / ${tenantId}`)
    await this.marketplaceService.getProducts(platform, tenantId, 0, 100)
  }
}
