import { Injectable, Logger } from '@nestjs/common'
import axios from 'axios'
import { PrismaService } from '../../prisma.service'
import type { MarketplaceProvider, MarketplaceCredentials, ConnectResult, TestResult, StatusResult, ProductsResult, OrdersResult, MarketplaceOrder, StockUpdate, MarketplaceMessage } from '../marketplace.interface'

@Injectable()
export class N11Provider implements MarketplaceProvider {
  readonly platform = 'n11'
  readonly label = 'n11'
  readonly color = 'purple'
  private readonly logger = new Logger(N11Provider.name)

  constructor(private prisma: PrismaService) {}

  private readonly baseUrl = 'https://api.n11.com/ws'

  private async getConfig(tenantId: string): Promise<MarketplaceCredentials | null> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { marketplaceApiKeys: true } })
    const keys = (tenant?.marketplaceApiKeys as any) || {}
    return keys.n11 || null
  }

  private async saveConfig(tenantId: string, config: MarketplaceCredentials) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { marketplaceApiKeys: true } })
    const current = (tenant?.marketplaceApiKeys as any) || {}
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { marketplaceApiKeys: { ...current, n11: config } },
    })
  }

  private buildSoapEnvelope(service: string, action: string, bodyXml: string): string {
    return `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:sch="http://www.n11.com/ws/schema">
  <soapenv:Header/>
  <soapenv:Body>
    <sch:${action}>${bodyXml}</sch:${action}>
  </soapenv:Body>
</soapenv:Envelope>`
  }

  private buildAuthXml(config: MarketplaceCredentials): string {
    return `<auth><appKey>${config.apiKey}</appKey><appSecret>${config.apiSecret}</appSecret></auth>`
  }

  private async soapCall(service: string, action: string, bodyXml: string): Promise<any> {
    const envelope = this.buildSoapEnvelope(service, action, bodyXml)
    const res = await axios.post(`${this.baseUrl}/${service}`, envelope, {
      headers: { 'Content-Type': 'text/xml;charset=UTF-8', SOAPAction: action },
      timeout: 15000,
    })
    const match = res.data.match(new RegExp(`<${action}Response>(.*?)</${action}Response>`, 's'))
    if (!match) throw new Error('SOAP yanıtı ayrıştırılamadı')
    const xml = match[1]
    const result: any = {}
    const tagRegex = /<(\w+)>(.*?)<\/\1>/gs
    let m
    while ((m = tagRegex.exec(xml)) !== null) {
      result[m[1]] = m[2]
    }
    return result
  }

  async connect(tenantId: string, creds: MarketplaceCredentials): Promise<ConnectResult> {
    try {
      if (!creds.apiKey || !creds.apiSecret) {
        return { success: false, message: 'API Key ve API Secret gerekli' }
      }
      const config: MarketplaceCredentials = { apiKey: creds.apiKey, apiSecret: creds.apiSecret }
      const test = await this.testConnection(config)
      if (!test.success) return test
      await this.saveConfig(tenantId, config)
      return { success: true, message: 'n11 bağlantısı başarılı' }
    } catch (e: any) {
      this.logger.error(`n11 connect failed: ${e.message}`)
      return { success: false, message: 'Bağlantı hatası: API bilgilerini kontrol edin' }
    }
  }

  async disconnect(tenantId: string): Promise<ConnectResult> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { marketplaceApiKeys: true } })
    const current = (tenant?.marketplaceApiKeys as any) || {}
    delete current.n11
    await this.prisma.tenant.update({ where: { id: tenantId }, data: { marketplaceApiKeys: current } })
    return { success: true, message: 'n11 bağlantısı kaldırıldı' }
  }

  async testConnection(creds: MarketplaceCredentials): Promise<TestResult> {
    try {
      const result = await this.soapCall('CategoryService', 'GetCategories', this.buildAuthXml(creds))
      return { success: true, message: 'Bağlantı başarılı' }
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
      const authXml = this.buildAuthXml(config)
      const bodyXml = `${authXml}<currentPage>${page}</currentPage><pageSize>${size}</pageSize>`
      const result = await this.soapCall('ProductService', 'GetProductList', bodyXml)
      const rawProducts = result?.products || result?.productList || []
      const products = (Array.isArray(rawProducts) ? rawProducts : [rawProducts]).map((p: any) => ({
        barcode: p.barcode || p.stockCode || '',
        title: p.title || p.name || '',
        price: parseFloat(p.salePrice) || parseFloat(p.price) || 0,
        stock: parseInt(p.quantity) || parseInt(p.stock) || 0,
        currency: 'TRY',
        description: p.description || '',
        images: p.images ? (Array.isArray(p.images) ? p.images : [p.images]) : [],
        category: p.categoryName || '',
        brand: p.brandName || '',
        marketplaceId: String(p.id || p.productId || ''),
      }))
      for (const pr of products) {
        await this.prisma.marketplaceProduct.upsert({
          where: { tenantId_platform_barcode: { tenantId, platform: 'n11', barcode: pr.barcode } },
          update: { title: pr.title, price: pr.price, stock: pr.stock, images: pr.images, syncAt: new Date() },
          create: { tenantId, platform: 'n11', barcode: pr.barcode, title: pr.title, price: pr.price, stock: pr.stock, currency: pr.currency, description: pr.description, images: pr.images, category: pr.category, brand: pr.brand, marketplaceId: pr.marketplaceId },
        })
      }
      return { products, total: products.length, page }
    } catch (e: any) {
      this.logger.error(`n11 getProducts: ${e.message}`)
      return { products: [], total: 0, page }
    }
  }

  async getOrders(tenantId: string, page = 0, size = 50, status?: string): Promise<OrdersResult> {
    const config = await this.getConfig(tenantId)
    if (!config) return { orders: [], total: 0, page }
    try {
      const authXml = this.buildAuthXml(config)
      let bodyXml = `${authXml}<currentPage>${page}</currentPage><pageSize>${size}</pageSize>`
      if (status) bodyXml += `<status>${status}</status>`
      const result = await this.soapCall('OrderService', 'OrderList', bodyXml)
      const rawOrders = result?.orders || result?.orderList || []
      const orders: MarketplaceOrder[] = (Array.isArray(rawOrders) ? rawOrders : [rawOrders]).map((o: any) => ({
        id: String(o.id || o.orderId || ''),
        orderNumber: o.orderNumber || o.id || '',
        customerName: o.billingAddress?.name || o.buyerName || o.customerName || '',
        customerEmail: o.billingAddress?.email || o.customerEmail || '',
        customerPhone: o.billingAddress?.phone || o.billingAddress?.gsm || '',
        products: (o.items || o.productList || []).map((l: any) => ({
          barcode: l.barcode || l.stockCode || '',
          title: l.productName || l.name || l.title || '',
          quantity: parseInt(l.quantity) || 1,
          price: parseFloat(l.price) || parseFloat(l.salePrice) || 0,
        })),
        totalAmount: parseFloat(o.totalAmount) || parseFloat(o.grandTotal) || 0,
        currency: 'TRY',
        status: o.status || 'pending',
        cargoStatus: o.cargoStatus || o.shipmentStatus || '',
        cargoCompany: o.carrierCompany || o.cargoCompany || '',
        cargoTracking: o.trackingNumber || o.cargoTracking || '',
        paymentStatus: o.paymentStatus || o.paymentType || '',
        orderDate: o.orderDate || o.createdAt || '',
      }))
      for (const ord of orders) {
        await this.prisma.marketplaceOrder.upsert({
          where: { marketplaceOrderId: ord.id },
          update: { status: ord.status, marketplaceStatus: ord.status, cargoStatus: ord.cargoStatus, cargoTracking: ord.cargoTracking, cargoCompany: ord.cargoCompany, products: ord.products as any, totalAmount: ord.totalAmount, updatedAt: new Date() },
          create: { tenantId, platform: 'n11', marketplaceOrderId: ord.id, orderNumber: ord.orderNumber, customerName: ord.customerName, customerContact: ord.customerEmail || ord.customerPhone, products: ord.products as any, totalAmount: ord.totalAmount, currency: ord.currency, status: 'pending', marketplaceStatus: ord.status, cargoStatus: ord.cargoStatus, cargoCompany: ord.cargoCompany, cargoTracking: ord.cargoTracking, paymentStatus: ord.paymentStatus, orderDate: ord.orderDate ? new Date(ord.orderDate) : null },
        })
      }
      return { orders, total: orders.length, page }
    } catch (e: any) {
      this.logger.error(`n11 getOrders: ${e.message}`)
      return { orders: [], total: 0, page }
    }
  }

  async updateStock(tenantId: string, updates: StockUpdate[]): Promise<ConnectResult> {
    if (!updates.length) return { success: false, message: 'Güncellenecek ürün yok' }
    const config = await this.getConfig(tenantId)
    if (!config) return { success: false, message: 'Bağlantı ayarları bulunamadı' }
    try {
      const authXml = this.buildAuthXml(config)
      const stockItemsXml = updates.map(u => `<stockItem><sellerStockCode>${u.barcode}</sellerStockCode><quantity>${u.quantity}</quantity></stockItem>`).join('')
      await this.soapCall('ProductStockService', 'UpdateStockByStockSellerCode', `${authXml}<stockItems>${stockItemsXml}</stockItems>`)
      for (const u of updates) {
        await this.prisma.marketplaceProduct.updateMany({
          where: { tenantId, platform: 'n11', barcode: u.barcode },
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
