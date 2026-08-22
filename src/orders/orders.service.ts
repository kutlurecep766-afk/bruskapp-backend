import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common'
import { Subject } from 'rxjs'
import { PrismaService } from '../prisma.service'
import { effectiveStoreStatus, parseStoreConfig } from '../storefront/storefront.service'

export interface OrderEvent {
  type: 'new_order' | 'status_update'
  order: any
}

function randomCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000))
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name)
  private usedCodes = new Set<string>()

  public orderEvents = new Subject<OrderEvent>()

  constructor(
    private prisma: PrismaService,
  ) {}

  async create(data: {
    tenantId: string
    platform: string
    customerName: string
    customerContact?: string
    products: any[]
    totalAmount: number
    currency?: string
    note?: string
    tableNumber?: number | null
    waiterId?: string | null
    deviceId?: string | null
    ipAddress?: string | null
  }) {
    if (data.customerName !== 'Test') {
      const tenant = await this.prisma.tenant.findUnique({ where: { id: data.tenantId }, select: { storefrontConfig: true } })
      const cfg = parseStoreConfig(tenant?.storefrontConfig)
      const status = effectiveStoreStatus(cfg.storeSettings, new Date(), data.tableNumber ? 'table' : 'online')
      if (status !== 'open') {
        if (status === 'busy') throw new BadRequestException('Şu anda yoğunluktan dolayı sipariş alınamamaktadır. En kısa sürede aktif olacaktır.')
        throw new BadRequestException('Şu anda sipariş alınamamaktadır. En kısa sürede aktif olacaktır.')
      }

      if (data.deviceId) {
        const blocked = await this.prisma.blockedDevice.findFirst({
          where: { tenantId: data.tenantId, deviceId: data.deviceId },
          select: { id: true },
        })
        if (blocked) {
          throw new BadRequestException('Bu cihazdan şu anda sipariş alınamamaktadır. İşletmeyle iletişime geçin.')
        }
      }
    }

    let trackingCode: string | null = null
    if (data.platform !== 'Garson Çağrı') {
      for (let attempt = 0; attempt < 10; attempt++) {
        const code = randomCode()
        const key = data.tenantId + ':' + code
        if (this.usedCodes.has(key)) continue
        const exists = await this.prisma.order.findFirst({ where: { tenantId: data.tenantId, trackingCode: code }, select: { id: true } })
        if (exists) continue
        trackingCode = code
        this.usedCodes.add(key)
        break
      }
    }

    const order = await this.prisma.order.create({
      data: {
        tenantId: data.tenantId,
        platform: data.platform,
        trackingCode,
        customerName: data.customerName,
        customerContact: data.customerContact || '',
        products: data.products,
        totalAmount: data.totalAmount,
        currency: data.currency || 'TRY',
        status: 'pending',
        note: data.note || '',
        tableNumber: data.tableNumber || null,
        waiterId: data.waiterId || null,
        deviceId: data.deviceId || null,
        ipAddress: data.ipAddress || null,
      },
    })

    this.orderEvents.next({ type: 'new_order', order })

    return order
  }

  async findAll(tenantId: string, limit = 50) {
    return this.prisma.order.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
  }

  async findById(id: number, tenantId: string) {
    return this.prisma.order.findFirst({ where: { id, tenantId } })
  }

  async findByTrackingCode(code: string, tenantId?: string) {
    const order = tenantId
      ? await this.prisma.order.findFirst({ where: { tenantId, trackingCode: code } })
      : await this.prisma.order.findFirst({ where: { trackingCode: code } })
    if (!order) return null
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: order.tenantId },
      select: { name: true, siteTitle: true, logoUrl: true, primaryColor: true, secondaryColor: true, storefrontConfig: true },
    })
    const cfg = tenant ? (typeof tenant.storefrontConfig === 'string' ? JSON.parse(tenant.storefrontConfig) : (tenant.storefrontConfig || {})) : {}
    return {
      id: order.id,
      trackingCode: order.trackingCode,
      platform: order.platform,
      status: order.status,
      tableNumber: order.tableNumber,
      totalAmount: order.totalAmount,
      products: order.products,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      note: order.note,
      customerNote: order.customerNote,
      customerName: order.customerName,
      customerContact: order.customerContact,
      businessName: tenant ? (cfg.shopName || tenant.siteTitle || tenant.name) : 'İşletme',
      logoUrl: tenant?.logoUrl || '',
      primaryColor: tenant?.primaryColor || '#2563eb',
      secondaryColor: tenant?.secondaryColor || '#1d4ed8',
    }
  }

  async updateStatus(id: number, status: string, tenantId: string, customerNote?: string) {
    const order = await this.prisma.order.findFirst({ where: { id, tenantId } })
    if (!order) throw new NotFoundException('Sipariş bulunamadı')

    const TERMINAL = ['delivered', 'completed', 'cancelled']
    const terminal = order.status
    if (TERMINAL.includes(terminal)) {
      const sameStatus = status === terminal
      if (sameStatus && customerNote !== undefined) {
        const updated = await this.prisma.order.update({
          where: { id },
          data: { customerNote },
        })
        this.orderEvents.next({ type: 'status_update', order: updated })
        return updated
      }
      throw new BadRequestException(`Sipariş ${terminal} durumunda, daha fazla güncelleme yapılamaz`)
    }

    const updated = await this.prisma.order.update({
      where: { id },
      data: { status, ...(customerNote !== undefined ? { customerNote } : {}) },
    })
    this.orderEvents.next({ type: 'status_update', order: updated })
    return updated
  }

  async blockOrder(id: number, tenantId: string, reason?: string) {
    const order = await this.prisma.order.findFirst({ where: { id, tenantId } })
    if (!order) throw new NotFoundException('Sipariş bulunamadı')
    if (!order.deviceId) {
      throw new BadRequestException('Bu siparişte engellenebilir cihaz kimliği yok')
    }
    const blocked = await this.prisma.blockedDevice.create({
      data: {
        tenantId,
        deviceId: order.deviceId,
        ipAddress: null,
        reason: reason || ('Sipariş #' + order.id + ' engellendi'),
      },
    })
    return blocked
  }

  async unblockOrder(id: number, tenantId: string) {
    const blocked = await this.prisma.blockedDevice.findFirst({ where: { id, tenantId } })
    if (!blocked) throw new NotFoundException('Engel bulunamadı')
    await this.prisma.blockedDevice.delete({ where: { id } })
    return { ok: true }
  }

  async listBlocked(tenantId: string) {
    return this.prisma.blockedDevice.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
  }
}