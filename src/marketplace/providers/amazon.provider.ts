import { Injectable, Logger } from '@nestjs/common'
import axios from 'axios'
import { PrismaService } from '../../prisma.service'
import type { MarketplaceProvider, MarketplaceCredentials, ConnectResult, TestResult, StatusResult, ProductsResult, OrdersResult, MarketplaceOrder, StockUpdate, MarketplaceMessage } from '../marketplace.interface'

@Injectable()
export class AmazonProvider implements MarketplaceProvider {
  readonly platform = 'amazon'
  readonly label = 'Amazon Turkey'
  readonly color = 'amber'
  private readonly logger = new Logger(AmazonProvider.name)

  constructor(private prisma: PrismaService) {}

  private get baseUrl() {
    return 'https://sellingpartnerapi-eu.amazon.com'
  }

  private async getConfig(tenantId: string): Promise<MarketplaceCredentials | null> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { marketplaceApiKeys: true } })
    const keys = (tenant?.marketplaceApiKeys as any) || {}
    return keys.amazon || null
  }

  private async saveConfig(tenantId: string, config: MarketplaceCredentials) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { marketplaceApiKeys: true } })
    const current = (tenant?.marketplaceApiKeys as any) || {}
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { marketplaceApiKeys: { ...current, amazon: config } },
    })
  }

  private async getAccessToken(config: MarketplaceCredentials): Promise<string> {
    const res = await axios.post('https://api.amazon.com/auth/o2/token', {
      grant_type: 'refresh_token',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
    }, { timeout: 10000 })
    return res.data.access_token
  }

  async connect(tenantId: string, creds: MarketplaceCredentials): Promise<ConnectResult> {
    try {
      if (!creds.clientId || !creds.clientSecret || !creds.refreshToken) {
        return { success: false, message: 'Client ID, Client Secret ve Refresh Token gerekli' }
      }
      await this.getAccessToken(creds)
      await this.saveConfig(tenantId, { clientId: creds.clientId, clientSecret: creds.clientSecret, refreshToken: creds.refreshToken, marketplaceId: creds.marketplaceId || 'A33AVAJ2PDY3EV', sellerId: creds.sellerId })
      return { success: true, message: 'Amazon bağlantısı başarılı' }
    } catch (e: any) {
      this.logger.error(`Amazon connect failed: ${e.message}`)
      return { success: false, message: 'Bağlantı hatası: Lütfen OAuth bilgilerini kontrol edin' }
    }
  }

  async disconnect(tenantId: string): Promise<ConnectResult> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { marketplaceApiKeys: true } })
    const current = (tenant?.marketplaceApiKeys as any) || {}
    delete current.amazon
    await this.prisma.tenant.update({ where: { id: tenantId }, data: { marketplaceApiKeys: current } })
    return { success: true, message: 'Amazon bağlantısı kaldırıldı' }
  }

  async testConnection(creds: MarketplaceCredentials): Promise<TestResult> {
    try {
      const token = await this.getAccessToken(creds)
      return { success: !!token, message: token ? 'Bağlantı başarılı' : 'Token alınamadı' }
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
      const token = await this.getAccessToken(config)
      const res = await axios.get(`${this.baseUrl}/catalog/2022-04-01/items`, {
        headers: { Authorization: `Bearer ${token}`, 'x-amz-access-token': token, 'Content-Type': 'application/json' },
        params: { marketplaceIds: config.marketplaceId, page, pageSize: size },
        timeout: 15000,
      })
      const items = res.data?.data || res.data?.items || []
      const products = items.map((p: any) => ({
        barcode: p.barcode || p.asin || '',
        title: p.title || p.name || p.itemName || '',
        price: parseFloat(p.price) || parseFloat(p.salePrice) || 0,
        stock: p.quantity || p.stock || 0,
        currency: 'TRY',
        description: p.description || '',
        images: p.images ? (typeof p.images === 'string' ? [p.images] : p.images) : [],
        category: p.category || p.categoryName || '',
        brand: p.brand || p.manufacturer || '',
        marketplaceId: p.asin || String(p.id || ''),
      }))
      for (const pr of products) {
        await this.prisma.marketplaceProduct.upsert({
          where: { tenantId_platform_barcode: { tenantId, platform: 'amazon', barcode: pr.barcode } },
          update: { title: pr.title, price: pr.price, stock: pr.stock, images: pr.images, syncAt: new Date() },
          create: { tenantId, platform: 'amazon', barcode: pr.barcode, title: pr.title, price: pr.price, stock: pr.stock, currency: pr.currency, description: pr.description, images: pr.images, category: pr.category, brand: pr.brand, marketplaceId: pr.marketplaceId },
        })
      }
      return { products, total: products.length, page }
    } catch (e: any) {
      this.logger.error(`Amazon getProducts: ${e.message}`)
      return { products: [], total: 0, page }
    }
  }

  async getOrders(tenantId: string, page = 0, size = 50, status?: string): Promise<OrdersResult> {
    const config = await this.getConfig(tenantId)
    if (!config) return { orders: [], total: 0, page }
    try {
      const token = await this.getAccessToken(config)
      const params: any = { marketplaceIds: config.marketplaceId, maxResultsPerPage: size }
      if (status) params.orderStatuses = status
      const res = await axios.get(`${this.baseUrl}/orders/v0/orders`, {
        headers: { Authorization: `Bearer ${token}`, 'x-amz-access-token': token },
        params, timeout: 15000,
      })
      const items = res.data?.payload?.orders || []
      const orders: MarketplaceOrder[] = items.map((o: any) => ({
        id: o.amazonOrderId || String(o.id || ''),
        orderNumber: o.amazonOrderId || o.orderNumber || '',
        customerName: o.buyerInfo?.buyerName || o.buyerName || '',
        customerEmail: o.buyerInfo?.buyerEmail || o.buyerEmail || '',
        customerPhone: o.buyerInfo?.buyerPhoneNumber || '',
        products: (o.items || o.orderItems || []).map((l: any) => ({
          barcode: l.asin || l.sellerSKU || '',
          title: l.title || l.productName || '',
          quantity: l.quantity || l.quantityOrdered || 1,
          price: parseFloat(l.price) || parseFloat(l.itemPrice?.amount) || 0,
        })),
        totalAmount: parseFloat(o.totalAmount) || parseFloat(o.orderTotal?.amount) || 0,
        currency: o.currency || o.orderTotal?.currencyCode || 'TRY',
        status: o.orderStatus || o.status || 'pending',
        cargoStatus: o.fulfillmentChannel || '',
        cargoCompany: o.carrier || '',
        cargoTracking: o.trackingNumber || '',
        paymentStatus: o.paymentStatus || '',
        orderDate: o.purchaseDate || o.createdAt || '',
      }))
      for (const ord of orders) {
        await this.prisma.marketplaceOrder.upsert({
          where: { marketplaceOrderId: ord.id },
          update: { status: ord.status, marketplaceStatus: ord.status, cargoStatus: ord.cargoStatus, cargoTracking: ord.cargoTracking, cargoCompany: ord.cargoCompany, products: ord.products as any, totalAmount: ord.totalAmount, updatedAt: new Date() },
          create: { tenantId, platform: 'amazon', marketplaceOrderId: ord.id, orderNumber: ord.orderNumber, customerName: ord.customerName, customerContact: ord.customerEmail || ord.customerPhone, products: ord.products as any, totalAmount: ord.totalAmount, currency: ord.currency, status: 'pending', marketplaceStatus: ord.status, cargoStatus: ord.cargoStatus, cargoCompany: ord.cargoCompany, cargoTracking: ord.cargoTracking, paymentStatus: ord.paymentStatus, orderDate: ord.orderDate ? new Date(ord.orderDate) : null },
        })
      }
      return { orders, total: items.length, page }
    } catch (e: any) {
      this.logger.error(`Amazon getOrders: ${e.message}`)
      return { orders: [], total: 0, page }
    }
  }

  async updateStock(tenantId: string, updates: StockUpdate[]): Promise<ConnectResult> {
    if (!updates.length) return { success: false, message: 'Güncellenecek ürün yok' }
    const config = await this.getConfig(tenantId)
    if (!config) return { success: false, message: 'Bağlantı ayarları bulunamadı' }
    try {
      const token = await this.getAccessToken(config)
      const feed = `<?xml version="1.0" encoding="utf-8"?>
<AmazonEnvelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="amzn-envelope.xsd">
  <Header><DocumentVersion>1.02</DocumentVersion><MerchantIdentifier>${config.sellerId}</MerchantIdentifier></Header>
  <MessageType>Inventory</MessageType>
  ${updates.map((u, i) => `<Message><MessageID>${i + 1}</MessageID><OperationType>Update</OperationType><Inventory><SKU>${u.barcode}</SKU><Quantity>${u.quantity}</Quantity></Inventory></Message>`).join('')}
</AmazonEnvelope>`
      await axios.post(`${this.baseUrl}/feeds/2021-06-30/feeds`, feed, {
        headers: { Authorization: `Bearer ${token}`, 'x-amz-access-token': token, 'Content-Type': 'application/xml' },
        timeout: 30000,
      })
      for (const u of updates) {
        await this.prisma.marketplaceProduct.updateMany({
          where: { tenantId, platform: 'amazon', barcode: u.barcode },
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
