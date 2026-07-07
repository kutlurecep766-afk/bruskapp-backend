import { Injectable, Logger } from '@nestjs/common'
import axios from 'axios'
import { PrismaService } from '../../prisma.service'
import { EncryptionService } from '../../common/encryption.service'
import { retryWithBackoff } from '../retry-handler'
import { toCommonOrder, saveCommonOrder } from '../adapters'
import type { MarketplaceProvider, MarketplaceCredentials, ConnectResult, TestResult, StatusResult, ProductsResult, OrdersResult, MarketplaceOrder, StockUpdate, MarketplaceMessage } from '../marketplace.interface'

@Injectable()
export class N11Provider implements MarketplaceProvider {
  readonly platform = 'n11'
  readonly label = 'n11'
  readonly color = 'purple'
  private readonly logger = new Logger(N11Provider.name)

  constructor(
    private prisma: PrismaService,
    private encryption: EncryptionService,
  ) {}

  private readonly baseUrl = 'https://api.n11.com/ws'

  private async getConfig(tenantId: string): Promise<MarketplaceCredentials | null> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { marketplaceApiKeys: true } })
    const keys = (tenant?.marketplaceApiKeys as any) || {}
    const raw = keys.n11 || null
    return raw ? this.encryption.decryptConfig(raw) : null
  }

  private async saveConfig(tenantId: string, config: MarketplaceCredentials) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { marketplaceApiKeys: true } })
    const current = (tenant?.marketplaceApiKeys as any) || {}
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { marketplaceApiKeys: { ...current, n11: this.encryption.encryptConfig(config) } },
    })
  }

  private buildSoapEnvelope(action: string, bodyXml: string): string {
    const requestAction = `${action}Request`
    return `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:sch="http://www.n11.com/ws/schemas">
  <soapenv:Header/>
  <soapenv:Body>
    <sch:${requestAction}>${bodyXml}</sch:${requestAction}>
  </soapenv:Body>
</soapenv:Envelope>`
  }

  private buildAuthXml(config: MarketplaceCredentials): string {
    return `<auth><appKey>${config.apiKey}</appKey><appSecret>${config.apiSecret}</appSecret></auth>`
  }

  private xmlToObj(xml: string): any {
    const obj: any = {}
    const re = /<(\w+)(?:\s[^>]*)?>(.*?)<\/\1>/gs
    let m
    while ((m = re.exec(xml)) !== null) {
      const [, k, v] = m
      const t = v.trim()
      const val = t.startsWith('<') ? this.xmlToObj(t) : t
      if (obj[k] !== undefined) {
        obj[k] = Array.isArray(obj[k]) ? [...obj[k], val] : [obj[k], val]
      } else {
        obj[k] = val
      }
    }
    return obj
  }

  private async soapCall(servicePath: string, action: string, bodyXml: string): Promise<any> {
    const responseAction = `${action}Response`
    const envelope = this.buildSoapEnvelope(action, bodyXml)
    const res = await retryWithBackoff(() => axios.post(`${this.baseUrl}/${servicePath}`, envelope, {
      headers: { 'Content-Type': 'text/xml;charset=UTF-8', SOAPAction: '' },
      timeout: 15000,
    }))
    const match = res.data.match(new RegExp(`<[^:]*:${responseAction}[^>]*>(.*?)</[^:]*:${responseAction}>`, 's'))
    if (!match) throw new Error('SOAP yanıtı ayrıştırılamadı')
    return this.xmlToObj(match[1])
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
      await this.soapCall('categoryService/', 'GetTopLevelCategories', this.buildAuthXml(creds))
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
      const bodyXml = `${this.buildAuthXml(config)}<pagingData><currentPage>${page}</currentPage><pageSize>${size}</pageSize></pagingData>`
      const result = await this.soapCall('productService/', 'GetProductList', bodyXml)
      const rawProducts = result?.products?.product
      const productArr = rawProducts ? (Array.isArray(rawProducts) ? rawProducts : [rawProducts]) : []
      const products = productArr.map((p: any) => {
        const stockItems = p.stockItems?.stockItem
        const stockArr = stockItems ? (Array.isArray(stockItems) ? stockItems : [stockItems]) : []
        const totalStock = stockArr.reduce((s: number, si: any) => s + (parseInt(si.quantity) || 0), 0)
        return {
          barcode: p.productSellerCode || '',
          title: p.title || '',
          price: parseFloat(p.displayPrice) || parseFloat(p.price) || 0,
          stock: totalStock,
          currency: 'TRY',
          description: '',
          images: [],
          category: typeof p.category === 'object' ? p.category.name || '' : String(p.category || ''),
          brand: '',
          marketplaceId: String(p.id || ''),
        }
      })
      for (const pr of products) {
        await this.prisma.marketplaceProduct.upsert({
          where: { tenantId_platform_barcode: { tenantId, platform: 'n11', barcode: pr.barcode } },
          update: { title: pr.title, price: pr.price, stock: pr.stock, images: pr.images, syncAt: new Date() },
          create: { tenantId, platform: 'n11', barcode: pr.barcode, title: pr.title, price: pr.price, stock: pr.stock, currency: pr.currency, description: pr.description, images: pr.images, category: pr.category, brand: pr.brand, marketplaceId: pr.marketplaceId },
        })
      }
      return { products, total: productArr.length, page }
    } catch (e: any) {
      this.logger.error(`n11 getProducts: ${e.message}`)
      return { products: [], total: 0, page }
    }
  }

  async getOrders(tenantId: string, page = 0, size = 50, status?: string): Promise<OrdersResult> {
    const config = await this.getConfig(tenantId)
    if (!config) return { orders: [], total: 0, page }
    try {
      const searchXml = status ? `<searchData><status>${status}</status></searchData>` : '<searchData/>'
      const bodyXml = `${this.buildAuthXml(config)}${searchXml}<pagingData><currentPage>${page}</currentPage><pageSize>${size}</pageSize></pagingData>`
      const result = await this.soapCall('orderService/', 'OrderList', bodyXml)
      const rawOrders = result?.orderList?.order
      const orderArr = rawOrders ? (Array.isArray(rawOrders) ? rawOrders : [rawOrders]) : []
      const orders: MarketplaceOrder[] = orderArr.map((o: any) => ({
        id: String(o.id || ''),
        orderNumber: o.orderNumber || String(o.id || ''),
        customerName: '',
        customerEmail: '',
        customerPhone: '',
        products: [],
        totalAmount: parseFloat(o.totalAmount) || 0,
        currency: 'TRY',
        status: String(o.status || ''),
        cargoStatus: '',
        cargoCompany: '',
        cargoTracking: '',
        paymentStatus: String(o.paymentType || ''),
        orderDate: o.createDate || '',
      }))
      for (const raw of orderArr) {
        await saveCommonOrder(this.prisma, toCommonOrder('n11', raw, tenantId))
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
      const version = Date.now().toString()
      const stockItemsXml = updates.map(u => `<stockItem><sellerStockCode>${u.barcode}</sellerStockCode><quantity>${u.quantity}</quantity><version>${version}</version></stockItem>`).join('')
      const result = await this.soapCall('productStockService/', 'UpdateStockByStockSellerCode', `${this.buildAuthXml(config)}<stockItems>${stockItemsXml}</stockItems>`)
      if (result?.result?.status !== 'success') throw new Error(result?.result?.errorMessage || 'Stok güncelleme başarısız')
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
