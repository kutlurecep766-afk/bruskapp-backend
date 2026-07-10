import { Controller, Get, Post, Param, Query, Body, Req, ForbiddenException } from '@nestjs/common'
import { PurchaseInvoicesService } from './purchase-invoices.service'

@Controller('purchase-invoices')
export class PurchaseInvoicesController {
  constructor(private purchaseInvoicesService: PurchaseInvoicesService) {}

  @Post()
  async create(@Req() req: any, @Body() body: {
    invoiceNo: string
    supplier: string
    date: string
    totalAmount: number
    currency?: string
    note?: string
    items: { productId: number; quantity: number; unitPrice: number }[]
  }) {
    const tenantId = req.user?.tenantId
    if (!tenantId) throw new ForbiddenException('İşletme bulunamadı')
    if (!body.items?.length) throw new ForbiddenException('En az bir ürün gerekli')
    return this.purchaseInvoicesService.create({
      ...body,
      tenantId,
      createdById: req.user?.id,
    })
  }

  @Get()
  async findAll(@Req() req: any, @Query('page') page?: string, @Query('size') size?: string) {
    const tenantId = req.user?.tenantId
    if (!tenantId) throw new ForbiddenException('İşletme bulunamadı')
    return this.purchaseInvoicesService.findAll(tenantId, parseInt(page || '0'), parseInt(size || '50'))
  }

  @Get(':id')
  async findById(@Req() req: any, @Param('id') id: string) {
    const tenantId = req.user?.tenantId
    if (!tenantId) throw new ForbiddenException('İşletme bulunamadı')
    return this.purchaseInvoicesService.findById(tenantId, parseInt(id))
  }
}
