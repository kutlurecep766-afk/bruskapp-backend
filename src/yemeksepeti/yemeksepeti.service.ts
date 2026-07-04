import { Injectable, Logger } from '@nestjs/common'
import axios from 'axios'
import { PrismaService } from '../prisma.service'
import { YemeksepetiConfig, YemeksepetiTokenResponse, YemeksepetiOrder } from './yemeksepeti.types'

@Injectable()
export class YemeksepetiService {
  private readonly logger = new Logger(YemeksepetiService.name)

  private baseUrl(testMode: boolean) {
    return testMode
      ? 'https://api-sandbox.yemeksepeti.com'
      : 'https://api.yemeksepeti.com'
  }

  constructor(private prisma: PrismaService) {}

  private async getConfig(tenantId: string): Promise<YemeksepetiConfig | null> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { marketplaceApiKeys: true } })
    const int = (tenant?.marketplaceApiKeys as any) || {}
    return int.yemeksepeti || null
  }

  private async saveConfig(tenantId: string, config: YemeksepetiConfig) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { marketplaceApiKeys: true } })
    const current = (tenant?.marketplaceApiKeys as any) || {}
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { marketplaceApiKeys: { ...current, yemeksepeti: config } },
    })
  }

  private async getToken(config: YemeksepetiConfig): Promise<string> {
    const testMode = config.testMode !== 'false'
    const base = this.baseUrl(testMode)
    const res = await axios.post<YemeksepetiTokenResponse>(`${base}/oauth/token`, {
      grant_type: 'client_credentials',
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }, { timeout: 10000 })
    return res.data.access_token
  }

  async connect(tenantId: string, body: { clientId: string; clientSecret: string; restaurantId: string; testMode?: string }) {
    try {
      const config: YemeksepetiConfig = {
        clientId: body.clientId,
        clientSecret: body.clientSecret,
        restaurantId: body.restaurantId,
        testMode: body.testMode,
      }
      await this.getToken(config)
      await this.saveConfig(tenantId, config)
      return { success: true, message: 'Yemeksepeti bağlantısı başarılı' }
    } catch (e: any) {
      this.logger.error(`Yemeksepeti connect failed: ${e.message}`)
      return { success: false, message: 'Bağlantı hatası: API bilgilerini kontrol edin' }
    }
  }

  async disconnect(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { marketplaceApiKeys: true } })
    const current = (tenant?.marketplaceApiKeys as any) || {}
    delete current.yemeksepeti
    await this.prisma.tenant.update({ where: { id: tenantId }, data: { marketplaceApiKeys: current } })
    return { success: true }
  }

  async getConnectionStatus(tenantId: string) {
    const config = await this.getConfig(tenantId)
    return { connected: !!config }
  }

  async testConnection(body: { clientId: string; clientSecret: string; restaurantId: string; testMode?: string }) {
    try {
      const token = await this.getToken({
        clientId: body.clientId,
        clientSecret: body.clientSecret,
        restaurantId: body.restaurantId,
        testMode: body.testMode,
      })
      return { success: !!token }
    } catch (e: any) {
      this.logger.error(`Yemeksepeti test failed: ${e.message}`)
      return { success: false, message: 'API bilgileri hatalı' }
    }
  }

  async getOrders(tenantId: string, page = 0, size = 50, status?: string) {
    const config = await this.getConfig(tenantId)
    if (!config) return { success: false, message: 'Bağlantı ayarları bulunamadı' }
    try {
      const token = await this.getToken(config)
      const base = this.baseUrl(config.testMode !== 'false')
      const params: any = { page, size, restaurantId: config.restaurantId }
      if (status) params.status = status
      const res = await axios.get(`${base}/api/v1/orders`, {
        headers: { Authorization: `Bearer ${token}` },
        params, timeout: 15000,
      })
      return { success: true, orders: res.data }
    } catch (e: any) {
      this.logger.error(`Yemeksepeti getOrders failed: ${e.message}`)
      return { success: false, message: 'Siparişler alınamadı' }
    }
  }

  async getProducts(tenantId: string) {
    const config = await this.getConfig(tenantId)
    if (!config) return { success: false, message: 'Bağlantı ayarları bulunamadı' }
    try {
      const token = await this.getToken(config)
      const base = this.baseUrl(config.testMode !== 'false')
      const res = await axios.get(`${base}/api/v1/restaurants/${config.restaurantId}/products`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 15000,
      })
      return { success: true, products: res.data }
    } catch (e: any) {
      this.logger.error(`Yemeksepeti getProducts failed: ${e.message}`)
      return { success: false, message: 'Ürünler alınamadı' }
    }
  }

  async updateStock(tenantId: string, updates: { barcode: string; quantity: number }[]) {
    const config = await this.getConfig(tenantId)
    if (!config) return { success: false, message: 'Bağlantı ayarları bulunamadı' }
    try {
      const token = await this.getToken(config)
      const base = this.baseUrl(config.testMode !== 'false')
      await axios.put(`${base}/api/v1/restaurants/${config.restaurantId}/stock`, updates, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        timeout: 15000,
      })
      return { success: true }
    } catch (e: any) {
      this.logger.error(`Yemeksepeti updateStock failed: ${e.message}`)
      return { success: false, message: 'Stok güncellenemedi' }
    }
  }

  async handleWebhook(tenantSlug: string, body: any) {
    const tenant = await this.prisma.tenant.findUnique({ where: { slug: tenantSlug }, select: { id: true, marketplaceApiKeys: true } })
    if (!tenant) return
    const config = (tenant.marketplaceApiKeys as any)?.yemeksepeti
    if (!config) return
    this.logger.log(`Yemeksepeti webhook: ${body.type} - ${body.orderId}`)
  }

  async registerWebhook(tenantId: string, url: string) {
    const config = await this.getConfig(tenantId)
    if (!config) return { success: false, message: 'Bağlantı ayarları bulunamadı' }
    try {
      const token = await this.getToken(config)
      const base = this.baseUrl(config.testMode !== 'false')
      await axios.post(`${base}/api/v1/webhooks`, { url, events: ['order.created', 'order.updated', 'order.cancelled'] }, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        timeout: 15000,
      })
      return { success: true }
    } catch (e: any) {
      this.logger.error(`Yemeksepeti registerWebhook failed: ${e.message}`)
      return { success: false, message: 'Webhook kaydedilemedi' }
    }
  }
}
