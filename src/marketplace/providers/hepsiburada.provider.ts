import { Injectable, Logger } from '@nestjs/common'
import { HepsiburadaService } from '../../hepsiburada/hepsiburada.service'
import type { MarketplaceProvider } from '../marketplace.interface'

@Injectable()
export class HepsiburadaProvider implements MarketplaceProvider {
  private readonly logger = new Logger(HepsiburadaProvider.name)
  platform = 'hepsiburada' as const
  label = 'Hepsiburada'
  color = 'purple'

  constructor(private readonly hepsiburadaService: HepsiburadaService) {}

  async connect(tenantId: string, credentials: any) {
    return this.hepsiburadaService.connect(tenantId, { apiKey: credentials.apiKey, apiSecret: credentials.apiSecret, merchantId: credentials.merchantId })
  }

  async disconnect(tenantId: string) {
    return this.hepsiburadaService.disconnect(tenantId) as any
  }

  async testConnection(credentials: any) {
    return this.hepsiburadaService.testConnection({ apiKey: credentials.apiKey, apiSecret: credentials.apiSecret, merchantId: credentials.merchantId }) as any
  }

  async getConnectionStatus(tenantId: string) {
    return this.hepsiburadaService.getConnectionStatus(tenantId)
  }

  async getProducts(tenantId: string, page = 0, size = 100) {
    return this.hepsiburadaService.getProducts(tenantId, page, size) as any
  }

  async getOrders(tenantId: string, page = 0, size = 50, status?: string) {
    return this.hepsiburadaService.getOrders(tenantId, page, size, status) as any
  }

  async updateStock(tenantId: string, updates: { barcode: string; quantity: number }[]) {
    return this.hepsiburadaService.updateStock(tenantId, updates) as any
  }

  async handleWebhook(tenantSlug: string, body: any) {
    return this.hepsiburadaService.handleWebhook(tenantSlug, body)
  }
}
