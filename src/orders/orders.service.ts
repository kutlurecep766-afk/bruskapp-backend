import { Injectable, Logger } from '@nestjs/common'
import { Subject } from 'rxjs'
import { PrismaService } from '../prisma.service'

export interface OrderEvent {
  type: 'new_order' | 'status_update'
  order: any
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name)
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
    const order = await this.prisma.order.create({
      data: {
        tenantId: data.tenantId,
        platform: data.platform,
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

  async findById(id: number) {
    return this.prisma.order.findUnique({ where: { id } })
  }

  async updateStatus(id: number, status: string) {
    const order = await this.prisma.order.update({
      where: { id },
      data: { status },
    })
    this.orderEvents.next({ type: 'status_update', order })
    return order
  }
}
