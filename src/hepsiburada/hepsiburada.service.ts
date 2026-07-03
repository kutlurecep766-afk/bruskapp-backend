import { Injectable, Logger, NotFoundException, BadRequestException, OnModuleInit, HttpException, HttpStatus } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { lastValueFrom } from 'rxjs'
import { PrismaService } from '../prisma.service'
import { OrdersService } from '../orders/orders.service'
import type { HepsiburadaCredentials, HepsiburadaProduct, HepsiburadaOrder, HepsiburadaMessage, StockUpdate } from './hepsiburada.types'

@Injectable()
export class HepsiburadaService implements OnModuleInit {
  private readonly logger = new Logger(HepsiburadaService.name)
  private readonly baseUrl = 'https://marketplace-api.hepsiburada.com'
  private pollingTimer: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly http: HttpService,
    private readonly prisma: PrismaService,
    private readonly ordersService: OrdersService,
  ) {}

  onModuleInit() {
    this.startPolling()
  }

  private startPolling() {
    if (this.pollingTimer) return
    this.logger.log('HB siparis polling baslatildi (30s)')
    this.pollAllTenants()
  }

  private async pollAllTenants() {
    try {
      const tenants = await this.prisma.tenant.findMany()
      let polled = 0
      for (const tenant of tenants) {
        const keys = tenant.marketplaceApiKeys as any
        if (!keys?.hepsiburada?.apiKey) continue
        try {
          await Promise.all([
            this.getOrders(tenant.id, 0, 50),
            this.getMessages(tenant.id),
          ])
          polled++
        } catch (e: any) {
          this.logger.warn('Polling hatasi (' + tenant.slug + '): ' + e.message)
        }
        await new Promise(r => setTimeout(r, 300))
      }
      if (polled > 0) this.logger.debug('Polling: ' + polled + ' tenant')
    } catch (e: any) {
      this.logger.error('Polling sorgu hatasi:', e.message)
    }
    this.pollingTimer = setTimeout(() => this.pollAllTenants(), 30000)
  }

  private async getCredentials(tenantId: string): Promise<HepsiburadaCredentials> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } })
    if (!tenant) throw new NotFoundException('Tenant bulunamadi')
    const keys = (tenant.marketplaceApiKeys as any)?.hepsiburada
    if (!keys?.apiKey || !keys?.apiSecret || !keys?.merchantId) {
      throw new BadRequestException('Hepsiburada API bilgileri eksik')
    }
    return keys as HepsiburadaCredentials
  }

  private getAuthHeaders(creds: HepsiburadaCredentials) {
    const encoded = Buffer.from(creds.apiKey + ':' + creds.apiSecret).toString('base64')
    return {
      Authorization: 'Basic ' + encoded,
      'Content-Type': 'application/json',
    }
  }

  async connect(tenantId: string, creds: HepsiburadaCredentials): Promise<{ success: boolean; message: string }> {
    if (!creds.apiKey || !creds.apiSecret || !creds.merchantId) {
      return { success: false, message: 'API Key, Secret ve Merchant ID gerekli' }
    }
    const test = await this.testConnection(creds)
    if (!test.success) return test
    const current = await this.getRawKeys(tenantId)
    current.hepsiburada = creds
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { marketplaceApiKeys: current },
    })
    return { success: true, message: 'Hepsiburada baglantisi basariyla kuruldu' }
  }

  async disconnect(tenantId: string): Promise<{ success: boolean; message: string }> {
    const current = await this.getRawKeys(tenantId)
    delete current.hepsiburada
    await this.prisma.tenant.update({ where: { id: tenantId }, data: { marketplaceApiKeys: current } })
    return { success: true, message: 'Hepsiburada baglantisi kaldirildi' }
  }

  async getConnectionStatus(tenantId: string): Promise<{ connected: boolean; merchantId?: string }> {
    try {
      const creds = await this.getCredentials(tenantId)
      return { connected: true, merchantId: creds.merchantId }
    } catch {
      return { connected: false }
    }
  }

  private async getRawKeys(tenantId: string): Promise<Record<string, any>> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } })
    return (tenant?.marketplaceApiKeys as any) || {}
  }

  async testConnection(creds: HepsiburadaCredentials): Promise<{ success: boolean; message: string }> {
    try {
      const encoded = Buffer.from(creds.apiKey + ':' + creds.apiSecret).toString('base64')
      const res = await lastValueFrom(
        this.http.get(this.baseUrl + '/merchant/' + creds.merchantId + '/products', {
          headers: { Authorization: 'Basic ' + encoded },
          params: { page: 0, size: 1 },
        })
      )
      return { success: true, message: 'Baglanti basarili' }
    } catch (e: any) {
      const errMsg = e?.response?.data?.errors?.[0]?.message || e?.response?.data?.message || e.message
      return { success: false, message: 'Baglanti hatasi: ' + errMsg }
    }
  }

  async getProducts(tenantId: string, page = 0, size = 100): Promise<{ products: HepsiburadaProduct[]; total: number; page: number }> {
    const creds = await this.getCredentials(tenantId)
    let res
    try {
      res = await lastValueFrom(
        this.http.get(this.baseUrl + '/merchant/' + creds.merchantId + '/products', {
          headers: this.getAuthHeaders(creds),
          params: { page, size },
        })
      )
    } catch (e: any) {
      const errMsg = e?.response?.data?.errors?.[0]?.message || e?.response?.data?.message || e.message
      this.logger.error('HB urunler alinamadi:', errMsg)
      throw new HttpException('Hepsiburada ürünler alınamadı: ' + errMsg, HttpStatus.BAD_GATEWAY)
    }
    const items = res.data?.data || res.data?.content || []
    const total = res.data?.totalElements || res.data?.total || items.length

    const products: HepsiburadaProduct[] = items.map((p: any) => ({
      barcode: p.barcode || p.merchantSku || '',
      title: p.title || p.name || '',
      price: parseFloat(p.salePrice) || parseFloat(p.listPrice) || parseFloat(p.price) || 0,
      stock: p.quantity || p.stock || 0,
      currency: p.currency || 'TRY',
      description: p.description || '',
      images: p.images || [],
      category: p.categoryName || p.category || '',
      brand: p.brand || '',
      marketplaceId: String(p.id || ''),
    }))

    for (const p of products) {
      await this.prisma.marketplaceProduct.upsert({
        where: { tenantId_platform_barcode: { tenantId, platform: 'hepsiburada', barcode: p.barcode } },
        update: { title: p.title, price: p.price, stock: p.stock, images: p.images, syncAt: new Date() },
        create: { tenantId, platform: 'hepsiburada', barcode: p.barcode, title: p.title, price: p.price, stock: p.stock, currency: p.currency, description: p.description, images: p.images, category: p.category, brand: p.brand, marketplaceId: p.marketplaceId },
      })
    }

    return { products, total, page }
  }

  async updateStock(tenantId: string, updates: StockUpdate[]): Promise<{ success: boolean; message: string; trackingId?: string }> {
    if (!updates.length) return { success: false, message: 'Guncellenecek urun bulunamadi' }
    const creds = await this.getCredentials(tenantId)
    const items = updates.map(u => ({ barcode: u.barcode, quantity: u.quantity }))
    try {
      const res = await lastValueFrom(
        this.http.post(
          this.baseUrl + '/merchant/' + creds.merchantId + '/products/stock',
          { items },
          { headers: this.getAuthHeaders(creds) },
        )
      )
      const trackingId = res.data?.trackingId || res.data?.id || ''
      for (const u of updates) {
        await this.prisma.marketplaceProduct.updateMany({
          where: { tenantId, platform: 'hepsiburada', barcode: u.barcode },
          data: { stock: u.quantity, syncAt: new Date() },
        })
      }
      if (trackingId) {
        return { success: true, message: updates.length + ' urun stogu guncellendi. Takip no: ' + trackingId, trackingId }
      }
      return { success: true, message: updates.length + ' urun stogu guncellendi' }
    } catch (e: any) {
      const errMsg = e?.response?.data?.errors?.[0]?.message || e?.response?.data?.message || e.message
      return { success: false, message: 'Stok guncelleme hatasi: ' + errMsg }
    }
  }

  async checkBulkStockStatus(tenantId: string, trackingId: string): Promise<{ success: boolean; status: string; details?: any }> {
    const creds = await this.getCredentials(tenantId)
    try {
      const res = await lastValueFrom(
        this.http.get(this.baseUrl + '/merchant/' + creds.merchantId + '/products/stock/' + trackingId, {
          headers: this.getAuthHeaders(creds),
        })
      )
      return { success: true, status: res.data?.status || 'unknown', details: res.data }
    } catch (e: any) {
      const errMsg = e?.response?.data?.errors?.[0]?.message || e?.response?.data?.message || e.message
      return { success: false, status: 'error', details: errMsg }
    }
  }

  async getOrders(tenantId: string, page = 0, size = 50, status?: string): Promise<{ orders: HepsiburadaOrder[]; total: number; page: number }> {
    const creds = await this.getCredentials(tenantId)
    const params: any = { page, size }
    if (status && status !== 'all') params.status = status

    let res
    try {
      res = await lastValueFrom(
        this.http.get(this.baseUrl + '/merchant/' + creds.merchantId + '/orders', {
          headers: this.getAuthHeaders(creds),
          params,
        })
      )
    } catch (e: any) {
      const errMsg = e?.response?.data?.errors?.[0]?.message || e?.response?.data?.message || e.message
      this.logger.error('HB siparisler alinamadi:', errMsg)
      throw new HttpException('Hepsiburada siparişler alınamadı: ' + errMsg, HttpStatus.BAD_GATEWAY)
    }
    const items = res.data?.data || res.data?.content || []
    const total = res.data?.totalElements || res.data?.total || items.length

    const orders: HepsiburadaOrder[] = items.map((o: any) => ({
      id: String(o.id || ''),
      orderNumber: o.orderNumber || o.orderId || '',
      customerName: o.customerName || o.billingAddress?.fullName || o.shippingAddress?.fullName || '',
      customerEmail: o.customerEmail || o.billingAddress?.email || '',
      customerPhone: o.customerPhone || o.billingAddress?.phone || '',
      products: (o.lines || o.items || []).map((l: any) => ({
        barcode: l.barcode || l.merchantSku || '',
        title: l.productName || l.title || l.name || '',
        quantity: l.quantity || 1,
        price: parseFloat(l.price) || 0,
      })),
      totalAmount: parseFloat(o.totalPrice) || parseFloat(o.grandTotal) || 0,
      currency: o.currency || 'TRY',
      status: o.status || 'pending',
      cargoStatus: o.cargoStatus || o.shipmentStatus || '',
      cargoCompany: o.cargoProviderName || o.carrierName || '',
      cargoTracking: o.cargoTrackingNumber || o.trackingNumber || '',
      paymentStatus: o.paymentStatus || o.paymentType || '',
      orderDate: o.orderDate || o.createdAt || o.createDate || '',
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
          platform: 'hepsiburada',
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
        where: { tenantId, platform: 'hepsiburada' },
        orderBy: { createdAt: 'desc' },
        skip: page * size,
        take: size,
      }),
      this.prisma.marketplaceOrder.count({ where: { tenantId, platform: 'hepsiburada' } }),
    ])
    return { orders, total }
  }

  async getMessages(tenantId: string): Promise<HepsiburadaMessage[]> {
    const creds = await this.getCredentials(tenantId)
    try {
      const res = await lastValueFrom(
        this.http.get(this.baseUrl + '/merchant/' + creds.merchantId + '/messages', {
          headers: this.getAuthHeaders(creds),
        })
      )
      return (res.data?.data || res.data || []).map((m: any) => ({
        id: String(m.id || ''),
        from: m.senderName || m.senderId || m.customerName || '',
        subject: m.subject || m.title || '',
        body: m.message || m.body || m.content || '',
        createdAt: m.createDateTime || m.createdAt || m.date || '',
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
      await lastValueFrom(
        this.http.post(
          this.baseUrl + '/merchant/' + creds.merchantId + '/messages',
          { recipientId: messageId, message: text, subject: 'BruskApp mesaji' },
          { headers: this.getAuthHeaders(creds) },
        )
      )
      return { success: true, message: 'Mesaj gonderildi' }
    } catch (e: any) {
      const errMsg = e?.response?.data?.errors?.[0]?.message || e?.response?.data?.message || e.message
      return { success: false, message: 'Gonderim hatasi: ' + errMsg }
    }
  }

  async handleWebhook(tenantSlug: string, body: any): Promise<void> {
    const tenant = await this.prisma.tenant.findUnique({ where: { slug: tenantSlug } })
    if (!tenant) throw new NotFoundException('Tenant bulunamadi: ' + tenantSlug)

    const orderId = body?.orderId || body?.orderNumber || body?.id || ''
    if (!orderId) {
      this.logger.warn('Webhook icinde orderId yok')
      return
    }

    try {
      await this.getOrders(tenant.id, 0, 1)
      this.logger.log('Webhook ile siparis senkronize: ' + orderId)
    } catch (e: any) {
      this.logger.error('Webhook sync hatasi:', e.message)
    }
  }
}
