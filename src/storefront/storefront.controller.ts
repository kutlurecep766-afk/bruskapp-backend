import { Controller, Get, Post, Put, Delete, Param, Body, Req, ForbiddenException } from '@nestjs/common'
import { StorefrontService } from './storefront.service'
import { Public } from '../auth/public.decorator'

@Controller('storefront')
export class StorefrontController {
  constructor(private service: StorefrontService) {}

  @Public()
  @Get(':slug')
  async getMenu(@Param('slug') slug: string) {
    return this.service.getMenu(slug)
  }

  @Get('admin/:tenantId/products')
  async getProducts(@Req() req: any, @Param('tenantId') tenantId: string) {
    if (req.user?.role !== 'SUPER_ADMIN') throw new ForbiddenException('Yetkiniz yok')
    return this.service.getProducts(tenantId)
  }

  @Post('admin/:tenantId/products')
  async addProduct(@Req() req: any, @Param('tenantId') tenantId: string, @Body() body: { name: string; price: number; description?: string; image?: string; category?: string }) {
    if (req.user?.role !== 'SUPER_ADMIN') throw new ForbiddenException('Yetkiniz yok')
    return this.service.addProduct(tenantId, body)
  }

  @Put('admin/:tenantId/products/:productId')
  async updateProduct(@Req() req: any, @Param('tenantId') tenantId: string, @Param('productId') productId: string, @Body() body: any) {
    if (req.user?.role !== 'SUPER_ADMIN') throw new ForbiddenException('Yetkiniz yok')
    return this.service.updateProduct(tenantId, productId, body)
  }

  @Delete('admin/:tenantId/products/:productId')
  async deleteProduct(@Req() req: any, @Param('tenantId') tenantId: string, @Param('productId') productId: string) {
    if (req.user?.role !== 'SUPER_ADMIN') throw new ForbiddenException('Yetkiniz yok')
    await this.service.deleteProduct(tenantId, productId)
    return { success: true }
  }

  @Put('admin/:tenantId/config')
  async updateConfig(@Req() req: any, @Param('tenantId') tenantId: string, @Body() body: { masaNumbers?: number[] }) {
    if (req.user?.role !== 'SUPER_ADMIN') throw new ForbiddenException('Yetkiniz yok')
    await this.service.updateConfig(tenantId, body)
    return { success: true }
  }
}
