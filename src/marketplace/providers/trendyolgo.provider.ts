import { Injectable, Logger } from '@nestjs/common'
import axios from 'axios'
import { PrismaService } from '../../prisma.service'
import { retryWithBackoff } from '../retry-handler'
import { toCommonOrder, saveCommonOrder } from '../adapters'
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
      ? 'https://stageapi.tgoapis.com/integrator'
      : 'https://api.tgoapis.com/integrator'
  }

  private authHeader(supplierId: string, apiSecretKey: string) {
    const encoded = Buffer.from(`${supplierId}:${apiSecretKey}`).toString('base64')
    return `Basic ${encoded}`
  }

  private headers(config: MarketplaceCredentials) {
    const base64 = Buffer.from(`${config.supplierId}:${config.apiSecretKey}`).toString('base64')
    return {
      Authorization: `Basic ${base64}`,
      'api-key': config.apiKey,
      'User-Agent': `${config.supplierId} - SelfIntegration`,
    }
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

  private async testAuth(config: MarketplaceCredentials): Promise<boolean> {
    try {
      const base = this.baseUrl(config.testMode === 'true')
      await retryWithBackoff(() => axios.get(`${base}/product/grocery/suppliers/${config.supplierId}/stores/${config.storeId}/products?page=0&size=1`, {
        headers: this.headers(config),
        timeout: 10000,
      }))
      return true
    } catch {
      return false
    }
  }

  async connect(tenantId: string, creds: MarketplaceCredentials): Promise<ConnectResult> {
    try {
      const config: MarketplaceCredentials = {
        supplierId: creds.supplierId,
        apiKey: creds.apiKey,
        apiSecretKey: creds.apiSecretKey,
        storeId: creds.storeId,
        testMode: creds.testMode || 'false',
      }
      const ok = await this.testAuth(config)
      if (!ok) return { success: false, message: 'API bilgileri hatalı, bağlantı sağlanamadı' }
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
      const ok = await this.testAuth(creds)
      return { success: ok, message: ok ? 'Bağlantı başarılı' : 'API bilgileri hatalı' }
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
      const base = this.baseUrl(config.testMode === 'true')
      const res = await retryWithBackoff(() => axios.get(
        `${base}/product/grocery/suppliers/${config.supplierId}/stores/${config.storeId}/products`,
        { headers: this.headers(config), params: { page, size }, timeout: 15000 },
      ))
      const items = res.data?.data || res.data?.content || res.data || []
      const products = items.map((p: any) => ({
        barcode: p.barcode || p.sku || '',
        title: p.name || p.title || '',
        price: parseFloat(p.price) || parseFloat(p.salePrice) || 0,
        stock: p.quantity || p.stock || 0,
        currency: 'TRY',
        description: p.description || '',
        images: (p.images || []).map((i: any) => (typeof i === 'string' ? i : i.url)),
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
      return { products, total: items.length, page }
    } catch (e: any) {
      this.logger.error(`TrendyolGo getProducts: ${e.message}`)
      return { products: [], total: 0, page }
    }
  }

  async getOrders(tenantId: string, page = 0, size = 50, status?: string): Promise<OrdersResult> {
    const config = await this.getConfig(tenantId)
    if (!config) return { orders: [], total: 0, page }
    try {
      const base = this.baseUrl(config.testMode === 'true')
      const params: any = { page, size, storeId: config.storeId }
      if (status) params.status = status
      const res = await retryWithBackoff(() => axios.get(
        `${base}/order/grocery/suppliers/${config.supplierId}/packages`,
        { headers: this.headers(config), params, timeout: 15000 },
      ))
      const items = res.data?.data || res.data?.content || res.data || []
      const orders: MarketplaceOrder[] = items.map((o: any) => ({
        id: String(o.id || o.packageId || ''),
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
        currency: 'TRY',
        status: o.status || 'pending',
        cargoStatus: o.deliveryStatus || '',
        cargoCompany: o.carrier || '',
        cargoTracking: o.trackingNumber || '',
        paymentStatus: o.paymentStatus || '',
        orderDate: o.createdAt || o.orderDate || '',
      }))
      for (const raw of items) {
        await saveCommonOrder(this.prisma, toCommonOrder('trendyolgo', raw, tenantId))
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
      const base = this.baseUrl(config.testMode === 'true')
      const items = updates.map(u => ({
        barcode: u.barcode,
        quantity: u.quantity,
        salePrice: undefined,
      }))
      await retryWithBackoff(() => axios.put(
        `${base}/product/grocery/suppliers/${config.supplierId}/products/price-and-inventory`,
        { items },
        { headers: { ...this.headers(config), 'Content-Type': 'application/json' }, timeout: 15000 },
      ))
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
