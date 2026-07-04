import { Controller, Get, Post, Param, Body, Query, Logger, BadRequestException } from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'
import { Public } from '../auth/public.decorator'
import { OrdersService } from './orders.service'
import { NotificationsService } from '../notifications/notifications.service'

@SkipThrottle()
@Controller('orders')
export class OrdersController {
  private readonly logger = new Logger(OrdersController.name)

  constructor(
    private ordersService: OrdersService,
    private notificationsService: NotificationsService,
  ) {}

  @Public()
  @Post()
  async create(@Body() body: {
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
    if (!body.tenantId) {
      throw new BadRequestException('tenantId alanı zorunludur')
    }
    if (!body.customerName) {
      throw new BadRequestException('Müşteri adı zorunludur')
    }
    const order = await this.ordersService.create({
      ...body,
      tableNumber: body.tableNumber ?? null,
      waiterId: body.waiterId ?? null,
    })

    await this.notificationsService.createNotification(
      body.platform,
      '🛒 Yeni Sipariş',
      body.platform + ' üzerinden ' + body.customerName + ' tarafından ' + body.totalAmount + ' ' + (body.currency || 'TRY') + ' tutarında sipariş verildi'
    )

    this.logger.log('Yeni sipariş: ' + order.id + ' - ' + body.customerName + ' (' + body.platform + ')')
    return order
  }

  @Public()
  @Get()
  async findAll(@Query('tenantId') tenantId: string, @Query('limit') limit?: string) {
    return this.ordersService.findAll(tenantId || 'default', limit ? parseInt(limit) : 50)
  }

  @Public()
  @Get(':id')
  async findById(@Param('id') id: string) {
    return this.ordersService.findById(parseInt(id))
  }

  @Public()
  @Post(':id/status')
  async updateStatus(@Param('id') id: string, @Body() body: { status: string }) {
    return this.ordersService.updateStatus(parseInt(id), body.status)
  }
}
