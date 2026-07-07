import { Injectable, Logger, NotFoundException, BadRequestException, HttpException, HttpStatus } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { PrismaService } from '../prisma.service'
import { OrdersService } from '../orders/orders.service'
import { httpRetry } from '../marketplace/retry-handler'
import type { TrendyolCredentials, TrendyolProduct, TrendyolOrder, TrendyolMessage, StockUpdate } from './trendyol.types'

@Injectable()
export class TrendyolService {
  private readonly logger = new Logger(TrendyolService.name)
  private readonly baseUrl = 'https://apigw.trendyol.com/integration'

  constructor(
    private readonly http: HttpService,
    private readonly prisma: PrismaService,
    private readonly ordersService: OrdersService,
  ) {}

  private async getCredentials(tenantId: string): Promise<TrendyolCredentials> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } })
    if (!tenant) throw new NotFoundException('Tenant bulunamadi')
    const keys = (tenant.marketplaceApiKeys as any)?.trendyol
    if (!keys?.apiKey || !keys?.apiSecret || !keys?.supplierId) {
      throw new BadRequestException('Trendyol API bilgileri eksik')
    }
    return keys as TrendyolCredentials
  }

  private getAuthHeaders(creds: TrendyolCredentials) {
    const encoded = Buffer.from(creds.apiKey + ':' + creds.apiSecret).toString('base64')
    return {
      Authorization: 'Basic ' + encoded,
      'User-Agent': creds.supplierId + ' - SelfIntegration',
    }
  }

  async connect(tenantId: string, creds: TrendyolCredentials): Promise<{ success: boolean; message: string }> {
    if (!creds.apiKey || !creds.apiSecret || !creds.supplierId) {
      return { success: false, message: 'API Key, Secret ve Satici ID gerekli' }
    }
    const test = await this.testConnection(creds)
    if (!test.success) return test
    const current = await this.getRawKeys(tenantId)
    current.trendyol = creds
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { marketplaceApiKeys: current },
    })
    return { success: true, message: 'Trendyol baglantisi basariyla kuruldu' }
  }

  async disconnect(tenantId: string): Promise<{ success: boolean; message: string }> {
    const current = await this.getRawKeys(tenantId)
    delete current.trendyol
    await this.prisma.tenant.update({ where: { id: tenantId }, data: { marketplaceApiKeys: current } })
    return { success: true, message: 'Trendyol baglantisi kaldirildi' }
  }

  async getConnectionStatus(tenantId: string): Promise<{ connected: boolean; supplierId?: string }> {
    try {
      const creds = await this.getCredentials(tenantId)
      return { connected: true, supplierId: creds.supplierId }
    } catch {
      return { connected: false }
    }
  }

  private async getRawKeys(tenantId: string): Promise<Record<string, any>> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } })
    return (tenant?.marketplaceApiKeys as any) || {}
  }

  async testConnection(creds: TrendyolCredentials): Promise<{ success: boolean; message: string }> {
    try {
      const encoded = Buffer.from(creds.apiKey + ':' + creds.apiSecret).toString('base64')
      const res = await httpRetry(() => this.http.get(this.baseUrl + '/product/sellers/' + creds.supplierId + '/products/approved', {
        headers: { Authorization: 'Basic ' + encoded, 'User-Agent': creds.supplierId + ' - SelfIntegration' },
        params: { page: 0, size: 1 },
      }))
      const count = res.data?.totalElements || 0
      return { success: true, message: count + ' urun bulundu' }
    } catch (e: any) {
      const errMsg = e?.response?.data?.errors?.[0]?.message || e?.response?.data?.message || e.message
      return { success: false, message: 'Baglanti hatasi: ' + errMsg }
    }
  }

  async getProducts(tenantId: string, page = 0, size = 100): Promise<{ products: TrendyolProduct[]; total: number; page: number }> {
    const creds = await this.getCredentials(tenantId)
    let res
    try {
      res = await httpRetry(() => this.http.get(this.baseUrl + '/product/sellers/' + creds.supplierId + '/products/approved', {
        headers: this.getAuthHeaders(creds),
        params: { page, size },
      }))
    } catch (e: any) {
      const errMsg = e?.response?.data?.errors?.[0]?.message || e?.response?.data?.message || e.message
      this.logger.error('Trendyol urunler alinamadi:', errMsg)
      throw new HttpException('Trendyol ürünler alınamadı: ' + errMsg, HttpStatus.BAD_GATEWAY)
    }
    const items = res.data?.content || []
    const total = res.data?.totalElements || 0

    const products: TrendyolProduct[] = items.map((p: any) => ({
      barcode: p.barcode || '',
      title: p.title || '',
      price: parseFloat(p.salePrice) || parseFloat(p.listPrice) || 0,
      stock: p.quantity || 0,
      currency: p.currencyType || 'TRY',
      description: p.description || '',
      images: (p.images || []).map((i: any) => i.url),
      category: p.categoryName || '',
      brand: p.brand || '',
      marketplaceId: String(p.id || ''),
    }))

    for (const p of products) {
      await this.prisma.marketplaceProduct.upsert({
        where: { tenantId_platform_barcode: { tenantId, platform: 'trendyol', barcode: p.barcode } },
        update: { title: p.title, price: p.price, stock: p.stock, images: p.images, syncAt: new Date() },
        create: { tenantId, platform: 'trendyol', barcode: p.barcode, title: p.title, price: p.price, stock: p.stock, currency: p.currency, description: p.description, images: p.images, category: p.category, brand: p.brand, marketplaceId: p.marketplaceId },
      })
    }

    return { products, total, page }
  }

  async updateStock(tenantId: string, updates: StockUpdate[]): Promise<{ success: boolean; message: string }> {
    if (!updates.length) return { success: false, message: 'Guncellenecek urun bulunamadi' }
    const creds = await this.getCredentials(tenantId)
    const items = updates.map(u => ({ barcode: u.barcode, quantity: u.quantity, salePrice: u.salePrice || undefined, listPrice: u.listPrice || undefined }))
    try {
      await httpRetry(() => this.http.post(
        this.baseUrl + '/inventory/sellers/' + creds.supplierId + '/products/price-and-inventory',
        { items },
        { headers: { ...this.getAuthHeaders(creds), 'Content-Type': 'application/json' } },
      ))
      for (const u of updates) {
        await this.prisma.marketplaceProduct.updateMany({
          where: { tenantId, platform: 'trendyol', barcode: u.barcode },
          data: { stock: u.quantity, syncAt: new Date() },
        })
      }
      return { success: true, message: updates.length + ' urun stogu guncellendi' }
    } catch (e: any) {
      const errMsg = e?.response?.data?.errors?.[0]?.message || e?.response?.data?.message || e.message
      return { success: false, message: 'Stok guncelleme hatasi: ' + errMsg }
    }
  }

  async getOrders(tenantId: string, page = 0, size = 50, status?: string): Promise<{ orders: TrendyolOrder[]; total: number; page: number }> {
    const creds = await this.getCredentials(tenantId)
    const params: any = { page, size, startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString() }
    if (status && status !== 'all') params.status = status

    let res
    try {
      res = await httpRetry(() => this.http.get(this.baseUrl + '/order/sellers/' + creds.supplierId + '/orders', {
        headers: this.getAuthHeaders(creds),
        params,
      }))
    } catch (e: any) {
      const errMsg = e?.response?.data?.errors?.[0]?.message || e?.response?.data?.message || e.message
      this.logger.error('Trendyol siparisler alinamadi:', errMsg)
      throw new HttpException('Trendyol siparişler alınamadı: ' + errMsg, HttpStatus.BAD_GATEWAY)
    }
    const items = res.data?.content || []
    const total = res.data?.totalElements || 0

    const orders: TrendyolOrder[] = items.map((o: any) => ({
      id: String(o.id || ''),
      orderNumber: o.orderNumber || '',
      customerName: o.customerName || '',
      customerEmail: o.customerEmail || '',
      customerPhone: o.customerPhone || '',
      products: (o.lines || []).map((l: any) => ({
        barcode: l.barcode || '',
        title: l.productName || l.title || '',
        quantity: l.quantity || 1,
        price: parseFloat(l.price) || 0,
      })),
      totalAmount: parseFloat(o.totalPrice) || 0,
      currency: o.currencyType || 'TRY',
      status: o.status || 'pending',
      cargoStatus: o.cargoStatus || '',
      cargoCompany: o.cargoProviderName || '',
      cargoTracking: o.cargoTrackingNumber || '',
      paymentStatus: o.paymentStatus || '',
      orderDate: o.orderDate || o.createdAt || '',
    }))

    for (const o of orders) {
      await this.prisma.marketplaceOrder.upsert({
        where: { marketplaceOrderId: o.id },
        update: {
          status: o.status,
          marketplaceStatus: o.status,
          cargoStatus: o.cargoStatus,
          cargoTracking: o.cargoTracking,
          cargoCompany: o.cargoCompany,
          products: o.products,
          totalAmount: o.totalAmount,
          updatedAt: new Date(),
        },
        create: {
          tenantId,
          platform: 'trendyol',
          marketplaceOrderId: o.id,
          orderNumber: o.orderNumber,
          customerName: o.customerName,
          customerContact: o.customerEmail || o.customerPhone,
          products: o.products,
          totalAmount: o.totalAmount,
          currency: o.currency,
          status: 'pending',
          marketplaceStatus: o.status,
          cargoStatus: o.cargoStatus,
          cargoCompany: o.cargoCompany,
          cargoTracking: o.cargoTracking,
          paymentStatus: o.paymentStatus,
          orderDate: o.orderDate ? new Date(o.orderDate) : null,
        },
      })
    }

    return { orders, total, page }
  }

  async getCachedOrders(tenantId: string, page = 0, size = 50): Promise<{ orders: any[]; total: number }> {
    const [orders, total] = await Promise.all([
      this.prisma.marketplaceOrder.findMany({
        where: { tenantId, platform: 'trendyol' },
        orderBy: { createdAt: 'desc' },
        skip: page * size,
        take: size,
      }),
      this.prisma.marketplaceOrder.count({ where: { tenantId, platform: 'trendyol' } }),
    ])
    return { orders, total }
  }

  async getMessages(tenantId: string): Promise<TrendyolMessage[]> {
    const creds = await this.getCredentials(tenantId)
    try {
      const res = await httpRetry(() => this.http.get(this.baseUrl + '/qna/sellers/' + creds.supplierId + '/questions/filter', {
        headers: this.getAuthHeaders(creds),
      }))
      return (res.data?.content || res.data || []).map((m: any) => ({
        id: String(m.id || m.questionId || ''),
        from: m.senderName || m.senderId || m.customerName || '',
        subject: m.subject || m.title || '',
        body: m.message || m.body || m.content || '',
        createdAt: m.createDateTime || m.createdAt || '',
        read: m.read || m.isRead || false,
      }))
    } catch (e: any) {
      this.logger.error('Mesajlar alinamadi:', e?.response?.data || e.message)
      return []
    }
  }

  async replyMessage(tenantId: string, messageId: string, text: string): Promise<{ success: boolean; message: string }> {
    const creds = await this.getCredentials(tenantId)
    try {
      await httpRetry(() => this.http.post(
        this.baseUrl + '/qna/sellers/' + creds.supplierId + '/questions/' + messageId + '/answer',
        { answer: text },
        { headers: { ...this.getAuthHeaders(creds), 'Content-Type': 'application/json' } },
      ))
      return { success: true, message: 'Mesaj gonderildi' }
    } catch (e: any) {
      const errMsg = e?.response?.data?.errors?.[0]?.message || e?.response?.data?.message || e.message
      return { success: false, message: 'Gonderim hatasi: ' + errMsg }
    }
  }

  async registerWebhook(tenantId: string, webhookUrl: string): Promise<{ success: boolean; message: string }> {
    const creds = await this.getCredentials(tenantId)
    try {
      await httpRetry(() => this.http.post(
        this.baseUrl + '/webhook/sellers/' + creds.supplierId + '/webhooks',
        { url: webhookUrl, authenticationType: 'API_KEY', apiKey: creds.apiKey, subscribedStatuses: ['CREATED', 'PICKING', 'INVOICED', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'RETURNED'] },
        { headers: { ...this.getAuthHeaders(creds), 'Content-Type': 'application/json' } },
      ))
      return { success: true, message: 'Webhook basariyla kaydedildi' }
    } catch (e: any) {
      const errMsg = e?.response?.data?.errors?.[0]?.message || e?.response?.data?.message || e.message
      return { success: false, message: 'Webhook kayit hatasi: ' + errMsg }
    }
  }

  async handleWebhook(tenantSlug: string, body: any): Promise<void> {
    const tenant = await this.prisma.tenant.findUnique({ where: { slug: tenantSlug } })
    if (!tenant) throw new NotFoundException('Tenant bulunamadi: ' + tenantSlug)

    const orderId = body?.orderId || body?.orderNumber || ''
    if (!orderId) {
      this.logger.warn('Webhook icinde orderId yok')
      return
    }

    try {
      await this.getOrders(tenant.id, 0, 50)
      this.logger.log('Webhook ile siparis senkronize: ' + orderId)
    } catch (e: any) {
      this.logger.error('Webhook sync hatasi:', e.message)
    }
  }
}