import { Injectable, Logger } from '@nestjs/common'
import axios from 'axios'
import { PrismaService } from '../../prisma.service'
import type { MarketplaceProvider, MarketplaceCredentials, ConnectResult, TestResult, StatusResult, ProductsResult, OrdersResult, MarketplaceOrder, StockUpdate, MarketplaceMessage } from '../marketplace.interface'

@Injectable()
export class TrendyolGoProvider implements MarketplaceProvider {
  readonly platform = 'trendyolgo'
  readonly label = 'Trendyol Go'
  readonly color = 'emerald'
  private readonly logger = new Logger(TrendyolGoProvider.name)

  constructor(private prisma: PrismaService) {}

  private baseUrl(testMode: boolean) {
    return testMode
      ? 'https://api-sandbox.tgoapps.com'
      : 'https://api.tgoapps.com'
  }

  private async getConfig(tenantId: string): Promise<MarketplaceCredentials | null> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { marketplaceApiKeys: true } })
    const keys = (tenant?.marketplaceApiKeys as any) || {}
    return keys.trendyolgo || null
  }

  private async saveConfig(tenantId: string, config: MarketplaceCredentials) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { marketplaceApiKeys: true } })
    const current = (tenant?.marketplaceApiKeys as any) || {}
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { marketplaceApiKeys: { ...current, trendyolgo: config } },
    })
  }

  private async getToken(config: MarketplaceCredentials): Promise<string> {
    const base = this.baseUrl(config.testMode === 'true')
    const res = await axios.post(`${base}/oauth/token`, {
      grant_type: 'client_credentials',
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }, { timeout: 10000 })
    return res.data.access_token
  }

  async connect(tenantId: string, creds: MarketplaceCredentials): Promise<ConnectResult> {
    try {
      const config: MarketplaceCredentials = {
        clientId: creds.clientId,
        clientSecret: creds.clientSecret,
        storeId: creds.storeId,
        testMode: creds.testMode || 'false',
      }
      await this.getToken(config)
      await this.saveConfig(tenantId, config)
      return { success: true, message: 'Trendyol Go bağlantısı başarılı' }
    } catch (e: any) {
      this.logger.error(`TrendyolGo connect failed: ${e.message}`)
      return { success: false, message: 'Bağlantı hatası: API bilgilerini kontrol edin' }
    }
  }

  async disconnect(tenantId: string): Promise<ConnectResult> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { marketplaceApiKeys: true } })
    const current = (tenant?.marketplaceApiKeys as any) || {}
    delete current.trendyolgo
    await this.prisma.tenant.update({ where: { id: tenantId }, data: { marketplaceApiKeys: current } })
    return { success: true, message: 'Trendyol Go bağlantısı kaldırıldı' }
  }

  async testConnection(creds: MarketplaceCredentials): Promise<TestResult> {
    try {
      const token = await this.getToken(creds)
      return { success: !!token, message: token ? 'Bağlantı başarılı' : 'Token alınamadı' }
    } catch (e: any) {
      return { success: false, message: 'API bilgileri hatalı' }
    }
  }

  async getConnectionStatus(tenantId: string): Promise<StatusResult> {
    const config = await this.getConfig(tenantId)
    return { connected: !!config, storeId: config?.storeId }
  }

  async getProducts(tenantId: string, page = 0, size = 100): Promise<ProductsResult> {
    const config = await this.getConfig(tenantId)
    if (!config) return { products: [], total: 0, page }
    try {
      const token = await this.getToken(config)
      const base = this.baseUrl(config.testMode === 'true')
      const res = await axios.get(`${base}/api/v1/stores/${config.storeId}/products`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { page, size }, timeout: 15000,
      })
      const items = res.data?.data || res.data?.content || res.data || []
      const products = items.map((p: any) => ({
        barcode: p.barcode || p.sku || '',
        title: p.name || p.title || '',
        price: parseFloat(p.price) || parseFloat(p.salePrice) || 0,
        stock: p.quantity || p.stock || 0,
        currency: p.currency || 'TRY',
        description: p.description || '',
        images: p.images || [],
        category: p.categoryName || '',
        brand: p.brand || '',
        marketplaceId: String(p.id || ''),
      }))
      for (const pr of products) {
        await this.prisma.marketplaceProduct.upsert({
          where: { tenantId_platform_barcode: { tenantId, platform: 'trendyolgo', barcode: pr.barcode } },
          update: { title: pr.title, price: pr.price, stock: pr.stock, images: pr.images, syncAt: new Date() },
          create: { tenantId, platform: 'trendyolgo', barcode: pr.barcode, title: pr.title, price: pr.price, stock: pr.stock, currency: pr.currency, description: pr.description, images: pr.images, category: pr.category, brand: pr.brand, marketplaceId: pr.marketplaceId },
        })
      }
      return { products, total: products.length, page }
    } catch (e: any) {
      this.logger.error(`TrendyolGo getProducts: ${e.message}`)
      return { products: [], total: 0, page }
    }
  }

  async getOrders(tenantId: string, page = 0, size = 50, status?: string): Promise<OrdersResult> {
    const config = await this.getConfig(tenantId)
    if (!config) return { orders: [], total: 0, page }
    try {
      const token = await this.getToken(config)
      const base = this.baseUrl(config.testMode === 'true')
      const params: any = { page, size, storeId: config.storeId }
      if (status) params.status = status
      const res = await axios.get(`${base}/api/v1/orders`, {
        headers: { Authorization: `Bearer ${token}` },
        params, timeout: 15000,
      })
      const items = res.data?.data || res.data?.content || res.data || []
      const orders: MarketplaceOrder[] = items.map((o: any) => ({
        id: String(o.id || ''),
        orderNumber: o.orderNumber || o.id,
        customerName: o.customer?.name || o.customerName || '',
        customerEmail: o.customer?.email || o.customerEmail || '',
        customerPhone: o.customer?.phone || o.customerPhone || '',
        products: (o.items || o.lines || []).map((l: any) => ({
          barcode: l.barcode || l.sku || '',
          title: l.productName || l.name || l.title || '',
          quantity: l.quantity || 1,
          price: parseFloat(l.price) || parseFloat(l.unitPrice) || 0,
        })),
        totalAmount: parseFloat(o.totalPrice) || parseFloat(o.grandTotal) || 0,
        currency: o.currency || 'TRY',
        status: o.status || 'pending',
        cargoStatus: o.deliveryStatus || '',
        cargoCompany: o.carrier || '',
        cargoTracking: o.trackingNumber || '',
        paymentStatus: o.paymentStatus || '',
        orderDate: o.createdAt || o.orderDate || '',
      }))
      for (const ord of orders) {
        await this.prisma.marketplaceOrder.upsert({
          where: { marketplaceOrderId: ord.id },
          update: { status: ord.status, marketplaceStatus: ord.status, cargoStatus: ord.cargoStatus, cargoTracking: ord.cargoTracking, cargoCompany: ord.cargoCompany, products: ord.products as any, totalAmount: ord.totalAmount, updatedAt: new Date() },
          create: { tenantId, platform: 'trendyolgo', marketplaceOrderId: ord.id, orderNumber: ord.orderNumber, customerName: ord.customerName, customerContact: ord.customerEmail || ord.customerPhone, products: ord.products as any, totalAmount: ord.totalAmount, currency: ord.currency, status: 'pending', marketplaceStatus: ord.status, cargoStatus: ord.cargoStatus, cargoCompany: ord.cargoCompany, cargoTracking: ord.cargoTracking, paymentStatus: ord.paymentStatus, orderDate: ord.orderDate ? new Date(ord.orderDate) : null },
        })
      }
      return { orders, total: items.length, page }
    } catch (e: any) {
      this.logger.error(`TrendyolGo getOrders: ${e.message}`)
      return { orders: [], total: 0, page }
    }
  }

  async updateStock(tenantId: string, updates: StockUpdate[]): Promise<ConnectResult> {
    if (!updates.length) return { success: false, message: 'Güncellenecek ürün yok' }
    const config = await this.getConfig(tenantId)
    if (!config) return { success: false, message: 'Bağlantı ayarları bulunamadı' }
    try {
      const token = await this.getToken(config)
      const base = this.baseUrl(config.testMode === 'true')
      await axios.put(`${base}/api/v1/stores/${config.storeId}/stock`, { items: updates }, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        timeout: 15000,
      })
      for (const u of updates) {
        await this.prisma.marketplaceProduct.updateMany({
          where: { tenantId, platform: 'trendyolgo', barcode: u.barcode },
          data: { stock: u.quantity, syncAt: new Date() },
        })
      }
      return { success: true, message: `${updates.length} ürün stoğu güncellendi` }
    } catch (e: any) {
      return { success: false, message: `Stok güncelleme hatası: ${e.message}` }
    }
  }

  async getMessages(tenantId: string): Promise<MarketplaceMessage[]> {
    return []
  }

  async handleWebhook(tenantSlug: string, body: any): Promise<void> {
    this.logger.log(`TrendyolGo webhook: ${body?.type}`)
  }
}
