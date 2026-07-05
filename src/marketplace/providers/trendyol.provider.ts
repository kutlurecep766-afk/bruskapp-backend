import { Injectable, Logger } from '@nestjs/common'
import { TrendyolService } from '../../trendyol/trendyol.service'
import type { MarketplaceProvider } from '../marketplace.interface'

@Injectable()
export class TrendyolProvider implements MarketplaceProvider {
  private readonly logger = new Logger(TrendyolProvider.name)
  platform = 'trendyol' as const
  label = 'Trendyol'
  color = 'orange'

  constructor(private readonly trendyolService: TrendyolService) {}

  async connect(tenantId: string, credentials: any) {
    return this.trendyolService.connect(tenantId, { apiKey: credentials.apiKey, apiSecret: credentials.apiSecret, supplierId: credentials.supplierId })
  }

  async disconnect(tenantId: string) {
    return this.trendyolService.disconnect(tenantId) as any
  }

  async testConnection(credentials: any) {
    return this.trendyolService.testConnection({ apiKey: credentials.apiKey, apiSecret: credentials.apiSecret, supplierId: credentials.supplierId }) as any
  }

  async getConnectionStatus(tenantId: string) {
    return this.trendyolService.getConnectionStatus(tenantId)
  }

  async getProducts(tenantId: string, page = 0, size = 100) {
    return this.trendyolService.getProducts(tenantId, page, size) as any
  }

  async getOrders(tenantId: string, page = 0, size = 50, status?: string) {
    return this.trendyolService.getOrders(tenantId, page, size, status) as any
  }

  async updateStock(tenantId: string, updates: { barcode: string; quantity: number }[]) {
    return this.trendyolService.updateStock(tenantId, updates) as any
  }

  async getMessages(tenantId: string) {
    return this.trendyolService.getMessages(tenantId) as any
  }

  async replyMessage(tenantId: string, messageId: string, text: string) {
    return this.trendyolService.replyMessage(tenantId, messageId, text) as any
  }

  async registerWebhook(tenantId: string, url: string) {
    return this.trendyolService.registerWebhook(tenantId, url) as any
  }

  async handleWebhook(tenantSlug: string, body: any) {
    return this.trendyolService.handleWebhook(tenantSlug, body)
  }
}
