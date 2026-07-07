import { Injectable, Logger } from '@nestjs/common'
import axios from 'axios'
import { PrismaService } from '../prisma.service'
import type { YemeksepetiConfig, YemeksepetiTokenResponse, YemeksepetiOrder } from './yemeksepeti.types'
import type { MarketplaceProduct, MarketplaceOrder } from '../marketplace/marketplace.interface'

const BASE_URL = 'https://yemeksepeti.partner.deliveryhero.io/v2'

@Injectable()
export class YemeksepetiService {
  private readonly logger = new Logger(YemeksepetiService.name)
  private readonly tokenCache = new Map<string, { token: string; expiresAt: number }>()

  constructor(private prisma: PrismaService) {}

  private async getConfig(tenantId: string): Promise<YemeksepetiConfig | null> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { marketplaceApiKeys: true } })
    const keys = (tenant?.marketplaceApiKeys as any) || {}
    return keys.yemeksepeti || null
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
    const cacheKey = config.clientId
    const cached = this.tokenCache.get(cacheKey)
    if (cached && Date.now() < cached.expiresAt) return cached.token

    const res = await axios.post<YemeksepetiTokenResponse>(`${BASE_URL}/oauth/token`,
      new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: config.clientId,
        client_secret: config.clientSecret,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10000 },
    )
    const expiresAt = Date.now() + (res.data.expires_in || 3600) * 1000
    this.tokenCache.set(cacheKey, { token: res.data.access_token, expiresAt })
    return res.data.access_token
  }

  async connect(tenantId: string, body: { clientId: string; clientSecret: string; chainId: string; vendorId: string }) {
    try {
      const config: YemeksepetiConfig = {
        clientId: body.clientId,
        clientSecret: body.clientSecret,
        chainId: body.chainId,
        vendorId: body.vendorId,
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
    return { connected: !!config, chainId: config?.chainId, vendorId: config?.vendorId }
  }

  async testConnection(body: { clientId: string; clientSecret: string; chainId: string; vendorId: string }) {
    try {
      const token = await this.getToken({
        clientId: body.clientId,
        clientSecret: body.clientSecret,
        chainId: body.chainId,
        vendorId: body.vendorId,
      })
      return { success: !!token }
    } catch (e: any) {
      this.logger.error(`Yemeksepeti test failed: ${e.message}`)
      return { success: false, message: 'API bilgileri hatalı' }
    }
  }

  async getProducts(tenantId: string, page = 0, size = 100) {
    const config = await this.getConfig(tenantId)
    if (!config) return { success: false, message: 'Bağlantı ayarları bulunamadı' }
    try {
      const token = await this.getToken(config)
      const res = await axios.get(`${BASE_URL}/chains/${config.chainId}/vendors/${config.vendorId}/catalog`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { page: page + 1, page_size: size },
        timeout: 15000,
      })
      const items = res.data?.products || []
      const products: MarketplaceProduct[] = items.map((p: any) => ({
        barcode: p.barcode || p.sku || '',
        title: p.name || '',
        price: parseFloat(p.price) || 0,
        stock: p.quantity || 0,
        currency: 'TRY',
        marketplaceId: p.sku || p.barcode || '',
      }))
      for (const pr of products) {
        await this.prisma.marketplaceProduct.upsert({
          where: { tenantId_platform_barcode: { tenantId, platform: 'yemeksepeti', barcode: pr.barcode } },
          update: { title: pr.title, price: pr.price, stock: pr.stock, syncAt: new Date() },
          create: { tenantId, platform: 'yemeksepeti', barcode: pr.barcode, title: pr.title, price: pr.price, stock: pr.stock, currency: pr.currency, marketplaceId: pr.marketplaceId },
        })
      }
      return { success: true, products, total: res.data?.total || items.length, page }
    } catch (e: any) {
      this.logger.error(`Yemeksepeti getProducts failed: ${e.message}`)
      return { success: false, message: 'Ürünler alınamadı' }
    }
  }

  async getOrders(tenantId: string, page = 0, size = 50, status?: string) {
    const config = await this.getConfig(tenantId)
    if (!config) return { success: false, message: 'Bağlantı ayarları bulunamadı' }
    try {
      const token = await this.getToken(config)
      const startTime = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
      const endTime = new Date().toISOString()
      const params: any = { page: page + 1, page_size: size, start_time: startTime, end_time: endTime }
      if (status) params.status = status
      const res = await axios.get(`${BASE_URL}/chains/${config.chainId}/vendors/${config.vendorId}`, {
        headers: { Authorization: `Bearer ${token}` },
        params,
        timeout: 15000,
      })
      const items = res.data?.orders || []
      const orders: MarketplaceOrder[] = items.map((o: any) => ({
        id: String(o.id || ''),
        orderNumber: o.id || '',
        customerName: o.customer?.name || '',
        customerEmail: o.customer?.email || '',
        customerPhone: o.customer?.phone || '',
        products: (o.items || []).map((l: any) => ({
          barcode: l.sku || '',
          title: l.name || '',
          quantity: l.quantity || 1,
          price: parseFloat(l.price) || 0,
        })),
        totalAmount: parseFloat(o.payment?.order_total?.amount) || parseFloat(o.total?.amount) || 0,
        currency: o.payment?.order_total?.currency || o.total?.currency || 'TRY',
        status: o.status || 'RECEIVED',
        orderDate: o.sys?.created_at || o.created_at || o.createdAt || '',
      }))
      for (const ord of orders) {
        await this.prisma.marketplaceOrder.upsert({
          where: { marketplaceOrderId: ord.id },
          update: { status: ord.status, marketplaceStatus: ord.status, products: ord.products as any, totalAmount: ord.totalAmount, updatedAt: new Date() },
          create: { tenantId, platform: 'yemeksepeti', marketplaceOrderId: ord.id, orderNumber: ord.orderNumber, customerName: ord.customerName, customerContact: ord.customerEmail || ord.customerPhone, products: ord.products as any, totalAmount: ord.totalAmount, currency: ord.currency, status: 'pending', marketplaceStatus: ord.status, orderDate: ord.orderDate ? new Date(ord.orderDate) : null },
        })
      }
      return { success: true, orders, total: res.data?.total || items.length, page }
    } catch (e: any) {
      this.logger.error(`Yemeksepeti getOrders failed: ${e.message}`)
      return { success: false, message: 'Siparişler alınamadı' }
    }
  }

  async updateStock(tenantId: string, updates: { barcode: string; quantity: number }[]) {
    const config = await this.getConfig(tenantId)
    if (!config) return { success: false, message: 'Bağlantı ayarları bulunamadı' }
    try {
      const token = await this.getToken(config)
      const products = updates.map(u => ({
        sku: u.barcode,
        quantity: u.quantity,
        active: u.quantity > 0,
      }))
      await axios.put(`${BASE_URL}/chains/${config.chainId}/vendors/${config.vendorId}/catalog`,
        { products },
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, timeout: 15000 },
      )
      for (const u of updates) {
        await this.prisma.marketplaceProduct.updateMany({
          where: { tenantId, platform: 'yemeksepeti', barcode: u.barcode },
          data: { stock: u.quantity, syncAt: new Date() },
        })
      }
      return { success: true }
    } catch (e: any) {
      this.logger.error(`Yemeksepeti updateStock failed: ${e.message}`)
      return { success: false, message: 'Stok güncellenemedi' }
    }
  }

  async updateOrderStatus(tenantId: string, orderId: string, body: any) {
    const config = await this.getConfig(tenantId)
    if (!config) return { success: false, message: 'Bağlantı ayarları bulunamadı' }
    try {
      const token = await this.getToken(config)
      await axios.put(`${BASE_URL}/chains/${config.chainId}/orders/${orderId}`,
        body,
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, timeout: 15000 },
      )
      return { success: true, message: 'Sipariş durumu güncellendi' }
    } catch (e: any) {
      this.logger.error(`Yemeksepeti updateOrderStatus: ${e.message}`)
      return { success: false, message: 'Sipariş durumu güncellenemedi' }
    }
  }

  async handleWebhook(tenantSlug: string, body: any) {
    const tenant = await this.prisma.tenant.findUnique({ where: { slug: tenantSlug }, select: { id: true, marketplaceApiKeys: true } })
    if (!tenant) return
    this.logger.log(`Yemeksepeti webhook: status=${body?.status} orderId=${body?.id}`)
    if (body?.id) {
      try {
        await this.getOrders(tenant.id, 0, 50)
      } catch (e: any) {
        this.logger.error(`Webhook sync error: ${e.message}`)
      }
    }
  }

  async registerWebhook(tenantId: string, url: string) {
    return { success: false, message: 'Webhook kaydı Yemeksepeti Partner Portal üzerinden yapılmalıdır' }
  }
}
