import { Controller, Get, Post, Param, Body, Query, Logger, BadRequestException } from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'
import { InjectQueue } from '@nestjs/bullmq'
import { Queue } from 'bullmq'
import { Public } from '../auth/public.decorator'
import { OrdersService } from './orders.service'

@SkipThrottle()
@Controller('orders')
export class OrdersController {
  private readonly logger = new Logger(OrdersController.name)

  constructor(
    private ordersService: OrdersService,
    @InjectQueue('order-processing') private orderQueue: Queue,
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
    customerVkn?: string
    customerTckn?: string
    customerEmail?: string
    customerPhone?: string
    customerAddress?: string
    customerTaxOffice?: string
  }) {
    if (!body.tenantId) {
      throw new BadRequestException('tenantId alani zorunludur')
    }
    if (!body.customerName) {
      throw new BadRequestException('Musteri adi zorunludur')
    }
    const order = await this.ordersService.create({
      ...body,
      tableNumber: body.tableNumber ?? null,
      waiterId: body.waiterId ?? null,
    })

    if (body.customerName !== 'Test') {
      this.orderQueue.add('send-invoice', body).catch(e => this.logger.warn('Queue invoice hatasi: ' + e.message))
      this.orderQueue.add('send-notification', body).catch(e => this.logger.warn('Queue notification hatasi: ' + e.message))
    }

    this.logger.log('Yeni siparis: ' + order.id + ' - ' + body.customerName + ' (' + body.platform + ')')
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