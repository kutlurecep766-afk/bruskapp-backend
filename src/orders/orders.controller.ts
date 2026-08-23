import { Controller, Get, Post, Put, Param, Body, Query, Req, Res, Logger, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'
import { InjectQueue } from '@nestjs/bullmq'
import { Queue } from 'bullmq'
import { Response } from 'express'
import { Public } from '../auth/public.decorator'
import { OrdersService } from './orders.service'
import { PrismaService } from '../prisma.service'

@SkipThrottle()
@Controller('orders')
export class OrdersController {
  private readonly logger = new Logger(OrdersController.name)

  constructor(
    private ordersService: OrdersService,
    private prisma: PrismaService,
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
    deviceId?: string
    customerVkn?: string
    customerTckn?: string
    customerEmail?: string
    customerPhone?: string
    customerAddress?: string
    customerTaxOffice?: string
  }, @Req() req: any) {
    if (!body.tenantId) {
      throw new BadRequestException('tenantId alani zorunludur')
    }
    if (!body.customerName) {
      throw new BadRequestException('Musteri adi zorunludur')
    }

    if (body.tableNumber && (body.platform === 'Masa' || body.platform === 'Garson Çağrı')) {
      const tenant = await this.prisma.tenant.findUnique({ where: { id: body.tenantId }, select: { storefrontConfig: true } })
      if (tenant?.storefrontConfig) {
        const cfg = typeof tenant.storefrontConfig === 'string' ? JSON.parse(tenant.storefrontConfig) : tenant.storefrontConfig
        const allowedTables: number[] = cfg.masaNumbers || []
        if (allowedTables.length > 0 && !allowedTables.includes(body.tableNumber)) {
          throw new ForbiddenException('Bu masa numarasi icin siparis alinmiyor')
        }
      }
    }

    const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() || req.ip || null

    const order = await this.ordersService.create({
      ...body,
      tableNumber: body.tableNumber ?? null,
      waiterId: body.waiterId ?? null,
      deviceId: body.deviceId || null,
      ipAddress: ip,
    })

    if (body.customerName !== 'Test' && body.platform !== 'Garson Çağrı') {
      this.orderQueue.add('send-invoice', body).catch(e => this.logger.warn('Queue invoice hatasi: ' + e.message))
      this.orderQueue.add('send-notification', body).catch(e => this.logger.warn('Queue notification hatasi: ' + e.message))
    }

    this.logger.log('Yeni siparis: ' + order.id + ' - ' + body.customerName + ' (' + body.platform + ')')
    return order
  }

  @Public()
  @Get('events')
  async events(@Query('tenantId') tenantId: string, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders()

    res.write(`retry: 3000\n\n`)

    const sub = this.ordersService.orderEvents.subscribe((evt) => {
      if (tenantId && evt.order.tenantId !== tenantId) return
      res.write(`event: ${evt.type}\ndata: ${JSON.stringify(evt.order)}\n\n`)
    })

    const heartbeat = setInterval(() => {
      try { res.write(': ping\n\n') } catch {}
    }, 25000)

    res.on('close', () => {
      clearInterval(heartbeat)
      sub.unsubscribe()
    })
  }

  @Public()
  @Get('tracking/:code')
  async trackOrder(@Param('code') code: string, @Query('slug') slug?: string) {
    if (!code || !/^\d{6}$/.test(code)) {
      throw new BadRequestException('Geçersiz sipariş kodu')
    }
    let tenantId: string | undefined
    if (slug) {
      const tenant = await this.prisma.tenant.findUnique({ where: { slug }, select: { id: true } })
      if (!tenant) throw new NotFoundException('İşletme bulunamadı')
      tenantId = tenant.id
    }
    const order = await this.ordersService.findByTrackingCode(code, tenantId)
    if (!order) throw new NotFoundException('Sipariş bulunamadı. Kodu kontrol edin veya işletmeyle iletişime geçin.')
    return order
  }

  @Public()
  @Get()
  async findAll(@Query('tenantId') tenantId: string, @Query('limit') limit?: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.ordersService.findAll(tenantId || 'default', limit ? parseInt(limit) : 50, from, to)
  }

  @Get('blocked')
  async listBlocked(@Req() req: any) {
    const tenantId = req.user?.tenantId
    if (!tenantId) throw new BadRequestException('tenantId bulunamadi')
    return this.ordersService.listBlocked(tenantId)
  }

  @Get(':id')
  async findById(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId
    if (!tenantId) throw new BadRequestException('tenantId bulunamadi')
    return this.ordersService.findById(parseInt(id), tenantId)
  }

  @Post(':id/block')
  async blockOrder(@Param('id') id: string, @Body() body: { reason?: string }, @Req() req: any) {
    const tenantId = req.user?.tenantId
    if (!tenantId) throw new BadRequestException('tenantId bulunamadi')
    return this.ordersService.blockOrder(parseInt(id), tenantId, body.reason)
  }

  @Post(':id/unblock')
  async unblockOrder(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId
    if (!tenantId) throw new BadRequestException('tenantId bulunamadi')
    return this.ordersService.unblockOrder(parseInt(id), tenantId)
  }

  @Post(':id/status')
  async updateStatus(@Param('id') id: string, @Body() body: { status: string; customerNote?: string }, @Req() req: any) {
    const tenantId = req.user?.tenantId
    if (!tenantId) throw new BadRequestException('tenantId bulunamadi')
    return this.ordersService.updateStatus(parseInt(id), body.status, tenantId, body.customerNote)
  }
}