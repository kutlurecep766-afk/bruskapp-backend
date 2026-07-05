import { Injectable, Logger } from '@nestjs/common'
import axios from 'axios'
import { PrismaService } from '../../prisma.service'
import type { MarketplaceProvider, MarketplaceCredentials, ConnectResult, TestResult, StatusResult, ProductsResult, OrdersResult, MarketplaceOrder, StockUpdate, MarketplaceMessage } from '../marketplace.interface'

@Injectable()
export class CicekSepetiProvider implements MarketplaceProvider {
  readonly platform = 'ciceksepeti'
  readonly label = 'ÇiçekSepeti'
  readonly color = 'pink'
  private readonly logger = new Logger(CicekSepetiProvider.name)

  constructor(private prisma: PrismaService) {}

  private readonly baseUrl = 'https://api.ciceksepeti.com'

  private async getConfig(tenantId: string): Promise<MarketplaceCredentials | null> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { marketplaceApiKeys: true } })
    const keys = (tenant?.marketplaceApiKeys as any) || {}
    return keys.ciceksepeti || null
  }

  private async saveConfig(tenantId: string, config: MarketplaceCredentials) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { marketplaceApiKeys: true } })
    const current = (tenant?.marketplaceApiKeys as any) || {}
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { marketplaceApiKeys: { ...current, ciceksepeti: config } },
    })
  }

  async connect(tenantId: string, creds: MarketplaceCredentials): Promise<ConnectResult> {
    try {
      if (!creds.apiKey || !creds.apiSecret) {
        return { success: false, message: 'API Key ve API Secret gerekli' }
      }
      const config: MarketplaceCredentials = { apiKey: creds.apiKey, apiSecret: creds.apiSecret, sellerId: creds.sellerId }
      const test = await this.testConnection(config)
      if (!test.success) return test
      await this.saveConfig(tenantId, config)
      return { success: true, message: 'ÇiçekSepeti bağlantısı başarılı' }
    } catch (e: any) {
      this.logger.error(`CicekSepeti connect failed: ${e.message}`)
      return { success: false, message: 'Bağlantı hatası: API bilgilerini kontrol edin' }
    }
  }

  async disconnect(tenantId: string): Promise<ConnectResult> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { marketplaceApiKeys: true } })
    const current = (tenant?.marketplaceApiKeys as any) || {}
    delete current.ciceksepeti
    await this.prisma.tenant.update({ where: { id: tenantId }, data: { marketplaceApiKeys: current } })
    return { success: true, message: 'ÇiçekSepeti bağlantısı kaldırıldı' }
  }

  async testConnection(creds: MarketplaceCredentials): Promise<TestResult> {
    try {
      const res = await axios.get(`${this.baseUrl}/v1/sellers/me`, {
        headers: { Authorization: `Bearer ${creds.apiKey}`, 'x-api-key': creds.apiKey },
        timeout: 10000,
      })
      return { success: res.status === 200, message: res.status === 200 ? 'Bağlantı başarılı' : 'API bilgileri hatalı' }
    } catch (e: any) {
      return { success: false, message: `API bilgileri hatalı: ${e.message}` }
    }
  }

  async getConnectionStatus(tenantId: string): Promise<StatusResult> {
    const config = await this.getConfig(tenantId)
    return { connected: !!config, sellerId: config?.sellerId }
  }

  async getProducts(tenantId: string, page = 0, size = 100): Promise<ProductsResult> {
    const config = await this.getConfig(tenantId)
    if (!config) return { products: [], total: 0, page }
    try {
      const res = await axios.get(`${this.baseUrl}/v1/products`, {
        headers: { Authorization: `Bearer ${config.apiKey}`, 'x-api-key': config.apiKey },
        params: { page, size }, timeout: 15000,
      })
      const items = res.data?.data || res.data?.products || []
      const products = items.map((p: any) => ({
        barcode: p.barcode || p.sku || '',
        title: p.name || p.title || '',
        price: parseFloat(p.salePrice) || parseFloat(p.price) || 0,
        stock: p.quantity || p.stock || 0,
        currency: 'TRY',
        description: p.description || '',
        images: p.images ? (Array.isArray(p.images) ? p.images : [p.images]) : [],
        category: p.categoryName || p.category || '',
        brand: p.brandName || p.brand || '',
        marketplaceId: String(p.id || p.productId || ''),
      }))
      for (const pr of products) {
        await this.prisma.marketplaceProduct.upsert({
          where: { tenantId_platform_barcode: { tenantId, platform: 'ciceksepeti', barcode: pr.barcode } },
          update: { title: pr.title, price: pr.price, stock: pr.stock, images: pr.images, syncAt: new Date() },
          create: { tenantId, platform: 'ciceksepeti', barcode: pr.barcode, title: pr.title, price: pr.price, stock: pr.stock, currency: pr.currency, description: pr.description, images: pr.images, category: pr.category, brand: pr.brand, marketplaceId: pr.marketplaceId },
        })
      }
      return { products, total: items.length, page }
    } catch (e: any) {
      this.logger.error(`CicekSepeti getProducts: ${e.message}`)
      return { products: [], total: 0, page }
    }
  }

  async getOrders(tenantId: string, page = 0, size = 50, status?: string): Promise<OrdersResult> {
    const config = await this.getConfig(tenantId)
    if (!config) return { orders: [], total: 0, page }
    try {
      const params: any = { page, size }
      if (status) params.status = status
      const res = await axios.get(`${this.baseUrl}/v1/orders`, {
        headers: { Authorization: `Bearer ${config.apiKey}`, 'x-api-key': config.apiKey },
        params, timeout: 15000,
      })
      const items = res.data?.data || res.data?.orders || []
      const orders: MarketplaceOrder[] = items.map((o: any) => ({
        id: String(o.id || o.orderId || ''),
        orderNumber: o.orderNumber || o.id || '',
        customerName: o.customer?.name || o.customerName || o.billingAddress?.fullName || '',
        customerEmail: o.customer?.email || o.customerEmail || '',
        customerPhone: o.customer?.phone || o.customerPhone || '',
        products: (o.items || o.lines || []).map((l: any) => ({
          barcode: l.barcode || l.sku || '',
          title: l.productName || l.name || l.title || '',
          quantity: l.quantity || 1,
          price: parseFloat(l.price) || parseFloat(l.unitPrice) || 0,
        })),
        totalAmount: parseFloat(o.totalPrice) || parseFloat(o.grandTotal) || 0,
        currency: 'TRY',
        status: o.status || 'pending',
        cargoStatus: o.cargoStatus || o.shipmentStatus || '',
        cargoCompany: o.carrier || o.cargoCompany || '',
        cargoTracking: o.trackingNumber || o.cargoTrackingNumber || '',
        paymentStatus: o.paymentStatus || '',
        orderDate: o.orderDate || o.createdAt || '',
      }))
      for (const ord of orders) {
        await this.prisma.marketplaceOrder.upsert({
          where: { marketplaceOrderId: ord.id },
          update: { status: ord.status, marketplaceStatus: ord.status, cargoStatus: ord.cargoStatus, cargoTracking: ord.cargoTracking, cargoCompany: ord.cargoCompany, products: ord.products as any, totalAmount: ord.totalAmount, updatedAt: new Date() },
          create: { tenantId, platform: 'ciceksepeti', marketplaceOrderId: ord.id, orderNumber: ord.orderNumber, customerName: ord.customerName, customerContact: ord.customerEmail || ord.customerPhone, products: ord.products as any, totalAmount: ord.totalAmount, currency: ord.currency, status: 'pending', marketplaceStatus: ord.status, cargoStatus: ord.cargoStatus, cargoCompany: ord.cargoCompany, cargoTracking: ord.cargoTracking, paymentStatus: ord.paymentStatus, orderDate: ord.orderDate ? new Date(ord.orderDate) : null },
        })
      }
      return { orders, total: items.length, page }
    } catch (e: any) {
      this.logger.error(`CicekSepeti getOrders: ${e.message}`)
      return { orders: [], total: 0, page }
    }
  }

  async updateStock(tenantId: string, updates: StockUpdate[]): Promise<ConnectResult> {
    if (!updates.length) return { success: false, message: 'Güncellenecek ürün yok' }
    const config = await this.getConfig(tenantId)
    if (!config) return { success: false, message: 'Bağlantı ayarları bulunamadı' }
    try {
      await axios.put(`${this.baseUrl}/v1/products/stock`, { items: updates.map(u => ({ barcode: u.barcode, quantity: u.quantity })) }, {
        headers: { Authorization: `Bearer ${config.apiKey}`, 'x-api-key': config.apiKey, 'Content-Type': 'application/json' },
        timeout: 15000,
      })
      for (const u of updates) {
        await this.prisma.marketplaceProduct.updateMany({
          where: { tenantId, platform: 'ciceksepeti', barcode: u.barcode },
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
}
