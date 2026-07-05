import { Injectable, Logger } from '@nestjs/common'
import { YemeksepetiService } from '../../yemeksepeti/yemeksepeti.service'
import type { MarketplaceProvider } from '../marketplace.interface'

@Injectable()
export class YemeksepetiProvider implements MarketplaceProvider {
  private readonly logger = new Logger(YemeksepetiProvider.name)
  platform = 'yemeksepeti' as const
  label = 'Yemeksepeti'
  color = 'red'

  constructor(private readonly yemeksepetiService: YemeksepetiService) {}

  async connect(tenantId: string, credentials: any) {
    return this.yemeksepetiService.connect(tenantId, { clientId: credentials.apiKey, clientSecret: credentials.apiSecret, restaurantId: credentials.restaurantId })
  }

  async disconnect(tenantId: string) {
    return this.yemeksepetiService.disconnect(tenantId) as any
  }

  async testConnection(credentials: any) {
    return this.yemeksepetiService.testConnection({ clientId: credentials.apiKey, clientSecret: credentials.apiSecret, restaurantId: credentials.restaurantId }) as any
  }

  async getConnectionStatus(tenantId: string) {
    return this.yemeksepetiService.getConnectionStatus(tenantId)
  }

  async getProducts(tenantId: string, page?: number, size?: number) {
    return this.yemeksepetiService.getProducts(tenantId) as any
  }

  async getOrders(tenantId: string, page = 0, size = 50, status?: string) {
    return this.yemeksepetiService.getOrders(tenantId, page, size, status) as any
  }

  async updateStock(tenantId: string, updates: { barcode: string; quantity: number }[]) {
    return this.yemeksepetiService.updateStock(tenantId, updates) as any
  }

  async registerWebhook(tenantId: string, url: string) {
    return this.yemeksepetiService.registerWebhook(tenantId, url) as any
  }

  async handleWebhook(tenantSlug: string, body: any) {
    return this.yemeksepetiService.handleWebhook(tenantSlug, body)
  }
}
