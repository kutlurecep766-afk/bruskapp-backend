import { Injectable, Logger } from '@nestjs/common'
import axios from 'axios'
import { PrismaService } from '../../prisma.service'
import type { MarketplaceProvider, MarketplaceCredentials, ConnectResult, TestResult, StatusResult, ProductsResult, OrdersResult, MarketplaceOrder, StockUpdate, MarketplaceMessage } from '../marketplace.interface'

@Injectable()
export class PazaramaProvider implements MarketplaceProvider {
  readonly platform = 'pazarama'
  readonly label = 'Pazarama'
  readonly color = 'blue'
  private readonly logger = new Logger(PazaramaProvider.name)

  constructor(private prisma: PrismaService) {}

  private readonly apiUrl = 'https://isortagimapi.pazarama.com'
  private readonly authUrl = 'https://isortagimgiris.pazarama.com/connect/token'

  private async getConfig(tenantId: string): Promise<MarketplaceCredentials | null> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { marketplaceApiKeys: true } })
    const keys = (tenant?.marketplaceApiKeys as any) || {}
    return keys.pazarama || null
  }

  private async saveConfig(tenantId: string, config: MarketplaceCredentials) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { marketplaceApiKeys: true } })
    const current = (tenant?.marketplaceApiKeys as any) || {}
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { marketplaceApiKeys: { ...current, pazarama: config } },
    })
  }

  private async getToken(config: MarketplaceCredentials): Promise<string> {
    const res = await axios.post(this.authUrl, `grant_type=client_credentials&client_id=${config.clientId}&client_secret=${config.clientSecret}`, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 10000,
    })
    return res.data.access_token
  }

  async connect(tenantId: string, creds: MarketplaceCredentials): Promise<ConnectResult> {
    try {
      if (!creds.clientId || !creds.clientSecret) {
        return { success: false, message: 'Client ID ve Client Secret gerekli' }
      }
      const config: MarketplaceCredentials = { clientId: creds.clientId, clientSecret: creds.clientSecret }
      await this.getToken(config)
      await this.saveConfig(tenantId, config)
      return { success: true, message: 'Pazarama bağlantısı başarılı' }
    } catch (e: any) {
      this.logger.error(`Pazarama connect failed: ${e.message}`)
      return { success: false, message: 'Bağlantı hatası: API bilgilerini kontrol edin' }
    }
  }

  async disconnect(tenantId: string): Promise<ConnectResult> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { marketplaceApiKeys: true } })
    const current = (tenant?.marketplaceApiKeys as any) || {}
    delete current.pazarama
    await this.prisma.tenant.update({ where: { id: tenantId }, data: { marketplaceApiKeys: current } })
    return { success: true, message: 'Pazarama bağlantısı kaldırıldı' }
  }

  async testConnection(creds: MarketplaceCredentials): Promise<TestResult> {
    try {
      const token = await this.getToken(creds)
      return { success: !!token, message: token ? 'Bağlantı başarılı' : 'Token alınamadı' }
    } catch (e: any) {
      return { success: false, message: `API bilgileri hatalı: ${e.message}` }
    }
  }

  async getConnectionStatus(tenantId: string): Promise<StatusResult> {
    const config = await this.getConfig(tenantId)
    return { connected: !!config }
  }

  async getProducts(tenantId: string, page = 0, size = 100): Promise<ProductsResult> {
    const config = await this.getConfig(tenantId)
    if (!config) return { products: [], total: 0, page }
    try {
      const token = await this.getToken(config)
      const res = await axios.get(`${this.apiUrl}/products`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { Page: page, Size: size }, timeout: 15000,
      })
      const items = res.data?.data || res.data?.items || []
      const products = items.map((p: any) => ({
        barcode: p.barcode || p.sku || '',
        title: p.title || p.name || '',
        price: parseFloat(p.salePrice) || parseFloat(p.price) || 0,
        stock: p.quantity || p.stock || 0,
        currency: 'TRY',
        description: p.description || '',
        images: p.images ? (Array.isArray(p.images) ? p.images : [p.images]) : [],
        category: p.categoryName || p.category || '',
        brand: p.brand || '',
        marketplaceId: String(p.id || ''),
      }))
      for (const pr of products) {
        await this.prisma.marketplaceProduct.upsert({
          where: { tenantId_platform_barcode: { tenantId, platform: 'pazarama', barcode: pr.barcode } },
          update: { title: pr.title, price: pr.price, stock: pr.stock, images: pr.images, syncAt: new Date() },
          create: { tenantId, platform: 'pazarama', barcode: pr.barcode, title: pr.title, price: pr.price, stock: pr.stock, currency: pr.currency, description: pr.description, images: pr.images, category: pr.category, brand: pr.brand, marketplaceId: pr.marketplaceId },
        })
      }
      return { products, total: items.length, page }
    } catch (e: any) {
      this.logger.error(`Pazarama getProducts: ${e.message}`)
      return { products: [], total: 0, page }
    }
  }

  async getOrders(tenantId: string, page = 0, size = 50, status?: string): Promise<OrdersResult> {
    const config = await this.getConfig(tenantId)
    if (!config) return { orders: [], total: 0, page }
    try {
      const token = await this.getToken(config)
      const params: any = { Page: page, Size: size }
      if (status) params.Status = status
      const res = await axios.get(`${this.apiUrl}/orders`, {
        headers: { Authorization: `Bearer ${token}` },
        params, timeout: 15000,
      })
      const items = res.data?.data || res.data?.items || []
      const orders: MarketplaceOrder[] = items.map((o: any) => ({
        id: String(o.id || ''),
        orderNumber: o.orderNumber || o.id || '',
        customerName: o.customerName || o.billingAddress?.fullName || '',
        customerEmail: o.customerEmail || '',
        customerPhone: o.customerPhone || '',
        products: (o.items || o.lines || []).map((l: any) => ({
          barcode: l.barcode || l.sku || '',
          title: l.productName || l.title || '',
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
          create: { tenantId, platform: 'pazarama', marketplaceOrderId: ord.id, orderNumber: ord.orderNumber, customerName: ord.customerName, customerContact: ord.customerEmail || ord.customerPhone, products: ord.products as any, totalAmount: ord.totalAmount, currency: ord.currency, status: 'pending', marketplaceStatus: ord.status, cargoStatus: ord.cargoStatus, cargoCompany: ord.cargoCompany, cargoTracking: ord.cargoTracking, paymentStatus: ord.paymentStatus, orderDate: ord.orderDate ? new Date(ord.orderDate) : null },
        })
      }
      return { orders, total: items.length, page }
    } catch (e: any) {
      this.logger.error(`Pazarama getOrders: ${e.message}`)
      return { orders: [], total: 0, page }
    }
  }

  async updateStock(tenantId: string, updates: StockUpdate[]): Promise<ConnectResult> {
    if (!updates.length) return { success: false, message: 'Güncellenecek ürün yok' }
    const config = await this.getConfig(tenantId)
    if (!config) return { success: false, message: 'Bağlantı ayarları bulunamadı' }
    try {
      const token = await this.getToken(config)
      await axios.post(`${this.apiUrl}/products/stock`, { items: updates.map(u => ({ barcode: u.barcode, quantity: u.quantity })) }, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        timeout: 15000,
      })
      for (const u of updates) {
        await this.prisma.marketplaceProduct.updateMany({
          where: { tenantId, platform: 'pazarama', barcode: u.barcode },
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
