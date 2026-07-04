import { Controller, Get, Post, Param, Body, Query, Logger, BadRequestException } from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'
import { Public } from '../auth/public.decorator'
import { OrdersService } from './orders.service'
import { NotificationsService } from '../notifications/notifications.service'
import { EInvoiceService } from '../einvoice/einvoice.service'

@SkipThrottle()
@Controller('orders')
export class OrdersController {
  private readonly logger = new Logger(OrdersController.name)

  constructor(
    private ordersService: OrdersService,
    private notificationsService: NotificationsService,
    private einvoiceService: EInvoiceService,
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

    this.autoSendInvoice(body).catch(e => this.logger.warn('Otomatik fatura kesilemedi: ' + e.message))

    await this.notificationsService.createNotification(
      body.platform,
      'Yeni Siparis',
      body.platform + ' uzerinden ' + body.customerName + ' tarafindan ' + body.totalAmount + ' ' + (body.currency || 'TRY') + ' tutarinda siparis verildi'
    )

    this.logger.log('Yeni siparis: ' + order.id + ' - ' + body.customerName + ' (' + body.platform + ')')
    return order
  }

  private async autoSendInvoice(body: any) {
    const vkn = body.customerVkn || body.customerTckn
    if (!vkn || !body.products?.length) return
    const result = await this.einvoiceService.sendInvoice(body.tenantId, {
      type: undefined as any,
      customer: {
        name: body.customerName,
        vkn: body.customerVkn,
        tckn: body.customerTckn,
        email: body.customerEmail,
        phone: body.customerPhone,
        address: body.customerAddress,
        taxOffice: body.customerTaxOffice,
      },
      lines: body.products.map((p: any) => ({
        name: p.name || p.title || 'Urun',
        quantity: p.quantity || 1,
        unitPrice: p.price || p.unitPrice || 0,
        vatRate: p.vatRate ?? 20,
      })),
      description: body.note || 'Siparis ' + body.platform,
    })
    if (result.success) {
      this.logger.log('Fatura otomatik kesildi: ' + result.invoiceNumber + ' - siparis: ' + body.platform)
    }
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