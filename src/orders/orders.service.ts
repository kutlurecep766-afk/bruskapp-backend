import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { Subject } from 'rxjs'
import { PrismaService } from '../prisma.service'

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
  private usedCodes = new Set<number>()

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
  }) {
    let trackingCode: string | null = null
    if (data.platform !== 'Garson Çağrı') {
      for (let attempt = 0; attempt < 10; attempt++) {
        const code = randomCode()
        const num = parseInt(code)
        if (this.usedCodes.has(num)) continue
        const exists = await this.prisma.order.findUnique({ where: { trackingCode: code }, select: { id: true } })
        if (exists) continue
        trackingCode = code
        this.usedCodes.add(num)
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

  async findByTrackingCode(code: string) {
    const order = await this.prisma.order.findUnique({
      where: { trackingCode: code },
    })
    if (!order) return null
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: order.tenantId },
      select: { name: true, siteTitle: true, logoUrl: true, primaryColor: true },
    })
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
      businessName: tenant?.siteTitle || tenant?.name || 'İşletme',
      logoUrl: tenant?.logoUrl || '',
      primaryColor: tenant?.primaryColor || '#2563eb',
    }
  }

  async updateStatus(id: number, status: string, tenantId: string, customerNote?: string) {
    const order = await this.prisma.order.findFirst({ where: { id, tenantId } })
    if (!order) throw new NotFoundException('Sipariş bulunamadı')
    const updated = await this.prisma.order.update({
      where: { id },
      data: { status, ...(customerNote !== undefined ? { note: customerNote } : {}) },
    })
    this.orderEvents.next({ type: 'status_update', order: updated })
    return updated
  }
}