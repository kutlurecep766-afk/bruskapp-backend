import { Controller, Get, Post, Param, Query, Body, Req, ForbiddenException } from '@nestjs/common'
import { StockMovementsService } from './stock-movements.service'

@Controller('stock-movements')
export class StockMovementsController {
  constructor(private stockMovementsService: StockMovementsService) {}

  @Get()
  async findAll(@Req() req: any, @Query('productId') productId?: string, @Query('page') page?: string, @Query('size') size?: string) {
    const tenantId = req.user?.tenantId
    if (!tenantId) throw new ForbiddenException('İşletme bulunamadı')
    return this.stockMovementsService.findAll(tenantId, productId ? parseInt(productId) : undefined, parseInt(page || '0'), parseInt(size || '50'))
  }
}
