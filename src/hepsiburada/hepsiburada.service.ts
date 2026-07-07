import { Injectable, Logger, NotFoundException, BadRequestException, HttpException, HttpStatus } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { PrismaService } from '../prisma.service'
import { OrdersService } from '../orders/orders.service'
import { httpRetry } from '../marketplace/retry-handler'
import type { HepsiburadaCredentials, HepsiburadaProduct, HepsiburadaOrder, StockUpdate } from './hepsiburada.types'

@Injectable()
export class HepsiburadaService {
  private readonly logger = new Logger(HepsiburadaService.name)
  private readonly listingBaseUrl = 'https://listing-external.hepsiburada.com'
  private readonly omsBaseUrl = 'https://oms-external.hepsiburada.com'

  constructor(
    private readonly http: HttpService,
    private readonly prisma: PrismaService,
    private readonly ordersService: OrdersService,
  ) {}

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
      'User-Agent': creds.merchantId + ' - BruskApp/1.0',
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
      await httpRetry(() => this.http.get(this.listingBaseUrl + '/listings/merchantid/' + creds.merchantId, {
        headers: { Authorization: 'Basic ' + encoded, 'User-Agent': 'BruskApp/1.0' },
        params: { offset: 0, limit: 1 },
      }))
      return { success: true, message: 'Baglanti basarili' }
    } catch (e: any) {
      const errMsg = e?.response?.data?.errors?.[0]?.errors?.[0] || e?.response?.data?.message || e.message
      return { success: false, message: 'Baglanti hatasi: ' + errMsg }
    }
  }

  async getProducts(tenantId: string, page = 0, size = 100): Promise<{ products: HepsiburadaProduct[]; total: number; page: number }> {
    const creds = await this.getCredentials(tenantId)
    const offset = page * size
    let res
    try {
      res = await httpRetry(() => this.http.get(this.listingBaseUrl + '/listings/merchantid/' + creds.merchantId, {
        headers: this.getAuthHeaders(creds),
        params: { offset, limit: size },
      }))
    } catch (e: any) {
      const errMsg = e?.response?.data?.errors?.[0]?.errors?.[0] || e?.response?.data?.message || e.message
      this.logger.error('HB urunler alinamadi:', errMsg)
      throw new HttpException('Hepsiburada ürünler alınamadı: ' + errMsg, HttpStatus.BAD_GATEWAY)
    }
    const items = res.data?.listings || []
    const total = res.data?.totalCount || items.length

    const products: HepsiburadaProduct[] = items.map((p: any) => ({
      barcode: p.barcode || p.merchantSku || p.hepsiburadaSku || '',
      title: p.title || p.productName || p.merchantSku || '',
      price: parseFloat(p.price) || 0,
      stock: p.availableStock || 0,
      currency: 'TRY',
      description: '',
      images: [],
      category: '',
      brand: '',
      marketplaceId: p.listingId || '',
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
    const items = updates.map(u => ({ merchantSku: u.barcode, availableStock: u.quantity }))
    try {
      const res = await httpRetry(() => this.http.post(
        this.listingBaseUrl + '/listings/merchantid/' + creds.merchantId + '/stock-uploads',
        items,
        { headers: this.getAuthHeaders(creds) },
      ))
      const trackingId = res.data?.id || ''
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
      const errMsg = e?.response?.data?.errors?.[0]?.errors?.[0] || e?.response?.data?.message || e.message
      return { success: false, message: 'Stok guncelleme hatasi: ' + errMsg }
    }
  }

  async checkBulkStockStatus(tenantId: string, trackingId: string): Promise<{ success: boolean; status: string; details?: any }> {
    const creds = await this.getCredentials(tenantId)
    try {
      const res = await httpRetry(() => this.http.get(this.listingBaseUrl + '/listings/merchantid/' + creds.merchantId + '/stock-uploads/id/' + trackingId, {
        headers: this.getAuthHeaders(creds),
      }))
      return { success: true, status: res.data?.status || 'unknown', details: res.data }
    } catch (e: any) {
      const errMsg = e?.response?.data?.errors?.[0]?.errors?.[0] || e?.response?.data?.message || e.message
      return { success: false, status: 'error', details: errMsg }
    }
  }

  async getOrders(tenantId: string, page = 0, size = 50, status?: string): Promise<{ orders: HepsiburadaOrder[]; total: number; page: number }> {
    const creds = await this.getCredentials(tenantId)
    const params: any = { offset: page * size, limit: size }
    if (status && status !== 'all') params.status = status

    let res
    try {
      res = await httpRetry(() => this.http.get(this.omsBaseUrl + '/orders/merchantId/' + creds.merchantId, {
        headers: this.getAuthHeaders(creds),
        params,
      }))
    } catch (e: any) {
      const errMsg = e?.response?.data?.errors?.[0]?.errors?.[0] || e?.response?.data?.message || e.message
      this.logger.error('HB siparisler alinamadi:', errMsg)
      throw new HttpException('Hepsiburada siparişler alınamadı: ' + errMsg, HttpStatus.BAD_GATEWAY)
    }
    const items = res.data?.data || res.data?.content || []
    const total = res.data?.totalElements || res.data?.total || items.length

    const orders: HepsiburadaOrder[] = items.map((o: any) => ({
      id: String(o.id || o.claimNumber || ''),
      orderNumber: o.claimNumber || o.orderNumber || '',
      customerName: o.customerName || o.buyerName || '',
      customerEmail: o.customerEmail || '',
      customerPhone: o.customerPhone || '',
      products: (o.lines || o.items || []).map((l: any) => ({
        barcode: l.merchantSku || l.barcode || '',
        title: l.productName || l.title || '',
        quantity: l.quantity || 1,
        price: parseFloat(l.price) || 0,
      })),
      totalAmount: parseFloat(o.totalPrice) || parseFloat(o.amount) || 0,
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