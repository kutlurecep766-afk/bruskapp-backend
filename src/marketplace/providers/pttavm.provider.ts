import { Injectable, Logger } from '@nestjs/common'
import axios from 'axios'
import { PrismaService } from '../../prisma.service'
import type { MarketplaceProvider, MarketplaceCredentials, ConnectResult, TestResult, StatusResult, ProductsResult, OrdersResult, MarketplaceOrder, StockUpdate, MarketplaceMessage } from '../marketplace.interface'

@Injectable()
export class PttAvmProvider implements MarketplaceProvider {
  readonly platform = 'pttavm'
  readonly label = 'PTTAVM'
  readonly color = 'yellow'
  private readonly logger = new Logger(PttAvmProvider.name)

  constructor(private prisma: PrismaService) {}

  private readonly baseUrl = 'https://api.epttavm.com'

  private async getConfig(tenantId: string): Promise<MarketplaceCredentials | null> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { marketplaceApiKeys: true } })
    const keys = (tenant?.marketplaceApiKeys as any) || {}
    return keys.pttavm || null
  }

  private async saveConfig(tenantId: string, config: MarketplaceCredentials) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { marketplaceApiKeys: true } })
    const current = (tenant?.marketplaceApiKeys as any) || {}
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { marketplaceApiKeys: { ...current, pttavm: config } },
    })
  }

  async connect(tenantId: string, creds: MarketplaceCredentials): Promise<ConnectResult> {
    try {
      if (!creds.username || !creds.password || !creds.shopId) {
        return { success: false, message: 'Kullanıcı adı, şifre ve Mağaza ID gerekli' }
      }
      const config: MarketplaceCredentials = { username: creds.username, password: creds.password, shopId: creds.shopId }
      const test = await this.testConnection(config)
      if (!test.success) return test
      await this.saveConfig(tenantId, config)
      return { success: true, message: 'PTTAVM bağlantısı başarılı' }
    } catch (e: any) {
      this.logger.error(`PttAvm connect failed: ${e.message}`)
      return { success: false, message: 'Bağlantı hatası: API bilgilerini kontrol edin' }
    }
  }

  async disconnect(tenantId: string): Promise<ConnectResult> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { marketplaceApiKeys: true } })
    const current = (tenant?.marketplaceApiKeys as any) || {}
    delete current.pttavm
    await this.prisma.tenant.update({ where: { id: tenantId }, data: { marketplaceApiKeys: current } })
    return { success: true, message: 'PTTAVM bağlantısı kaldırıldı' }
  }

  async testConnection(creds: MarketplaceCredentials): Promise<TestResult> {
    try {
      const encoded = Buffer.from(creds.username + ':' + creds.password).toString('base64')
      const res = await axios.get(`${this.baseUrl}/shop/${creds.shopId}/products`, {
        headers: { Authorization: `Basic ${encoded}` },
        params: { page: 0, size: 1 }, timeout: 10000,
      })
      return { success: res.status === 200, message: 'Bağlantı başarılı' }
    } catch (e: any) {
      return { success: false, message: `API bilgileri hatalı: ${e.message}` }
    }
  }

  async getConnectionStatus(tenantId: string): Promise<StatusResult> {
    const config = await this.getConfig(tenantId)
    return { connected: !!config, shopId: config?.shopId }
  }

  async getProducts(tenantId: string, page = 0, size = 100): Promise<ProductsResult> {
    const config = await this.getConfig(tenantId)
    if (!config) return { products: [], total: 0, page }
    try {
      const encoded = Buffer.from(config.username + ':' + config.password).toString('base64')
      const res = await axios.get(`${this.baseUrl}/shop/${config.shopId}/products`, {
        headers: { Authorization: `Basic ${encoded}` },
        params: { page, size }, timeout: 15000,
      })
      const items = res.data?.data || res.data?.products || res.data || []
      const products = items.map((p: any) => ({
        barcode: p.barcode || p.stockCode || '',
        title: p.title || p.name || '',
        price: parseFloat(p.salePrice) || parseFloat(p.price) || 0,
        stock: p.quantity || p.stock || 0,
        currency: 'TRY',
        description: p.description || '',
        images: p.images ? (Array.isArray(p.images) ? p.images : [p.images]) : [],
        category: p.categoryName || p.category || '',
        brand: p.brand || '',
        marketplaceId: String(p.id || p.productId || ''),
      }))
      for (const pr of products) {
        await this.prisma.marketplaceProduct.upsert({
          where: { tenantId_platform_barcode: { tenantId, platform: 'pttavm', barcode: pr.barcode } },
          update: { title: pr.title, price: pr.price, stock: pr.stock, images: pr.images, syncAt: new Date() },
          create: { tenantId, platform: 'pttavm', barcode: pr.barcode, title: pr.title, price: pr.price, stock: pr.stock, currency: pr.currency, description: pr.description, images: pr.images, category: pr.category, brand: pr.brand, marketplaceId: pr.marketplaceId },
        })
      }
      return { products, total: items.length, page }
    } catch (e: any) {
      this.logger.error(`PttAvm getProducts: ${e.message}`)
      return { products: [], total: 0, page }
    }
  }

  async getOrders(tenantId: string, page = 0, size = 50, status?: string): Promise<OrdersResult> {
    const config = await this.getConfig(tenantId)
    if (!config) return { orders: [], total: 0, page }
    try {
      const encoded = Buffer.from(config.username + ':' + config.password).toString('base64')
      const params: any = { page, size }
      if (status) params.status = status
      const res = await axios.get(`${this.baseUrl}/shop/${config.shopId}/orders`, {
        headers: { Authorization: `Basic ${encoded}` },
        params, timeout: 15000,
      })
      const items = res.data?.data || res.data?.orders || []
      const orders: MarketplaceOrder[] = items.map((o: any) => ({
        id: String(o.id || ''),
        orderNumber: o.orderNumber || o.id || '',
        customerName: o.customerName || o.billingAddress?.name || '',
        customerEmail: o.customerEmail || '',
        customerPhone: o.customerPhone || '',
        products: (o.items || o.lines || []).map((l: any) => ({
          barcode: l.barcode || l.stockCode || '',
          title: l.productName || l.title || '',
          quantity: l.quantity || 1,
          price: parseFloat(l.price) || parseFloat(l.unitPrice) || 0,
        })),
        totalAmount: parseFloat(o.totalPrice) || parseFloat(o.grandTotal) || 0,
        currency: 'TRY',
        status: o.status || 'pending',
        cargoStatus: o.cargoStatus || '',
        cargoCompany: o.carrier || o.cargoCompany || '',
        cargoTracking: o.trackingNumber || '',
        paymentStatus: o.paymentStatus || '',
        orderDate: o.orderDate || o.createdAt || '',
      }))
      for (const ord of orders) {
        await this.prisma.marketplaceOrder.upsert({
          where: { marketplaceOrderId: ord.id },
          update: { status: ord.status, marketplaceStatus: ord.status, cargoStatus: ord.cargoStatus, cargoTracking: ord.cargoTracking, cargoCompany: ord.cargoCompany, products: ord.products as any, totalAmount: ord.totalAmount, updatedAt: new Date() },
          create: { tenantId, platform: 'pttavm', marketplaceOrderId: ord.id, orderNumber: ord.orderNumber, customerName: ord.customerName, customerContact: ord.customerEmail || ord.customerPhone, products: ord.products as any, totalAmount: ord.totalAmount, currency: ord.currency, status: 'pending', marketplaceStatus: ord.status, cargoStatus: ord.cargoStatus, cargoCompany: ord.cargoCompany, cargoTracking: ord.cargoTracking, paymentStatus: ord.paymentStatus, orderDate: ord.orderDate ? new Date(ord.orderDate) : null },
        })
      }
      return { orders, total: items.length, page }
    } catch (e: any) {
      this.logger.error(`PttAvm getOrders: ${e.message}`)
      return { orders: [], total: 0, page }
    }
  }

  async updateStock(tenantId: string, updates: StockUpdate[]): Promise<ConnectResult> {
    if (!updates.length) return { success: false, message: 'Güncellenecek ürün yok' }
    const config = await this.getConfig(tenantId)
    if (!config) return { success: false, message: 'Bağlantı ayarları bulunamadı' }
    try {
      const encoded = Buffer.from(config.username + ':' + config.password).toString('base64')
      await axios.post(`${this.baseUrl}/shop/${config.shopId}/products/stock`, { items: updates.map(u => ({ barcode: u.barcode, quantity: u.quantity })) }, {
        headers: { Authorization: `Basic ${encoded}`, 'Content-Type': 'application/json' },
        timeout: 15000,
      })
      for (const u of updates) {
        await this.prisma.marketplaceProduct.updateMany({
          where: { tenantId, platform: 'pttavm', barcode: u.barcode },
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
