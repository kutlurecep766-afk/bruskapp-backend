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

  @Get('admin/me')
  async getMyStorefront(@Req() req: any) {
    const tenantId = req.user?.tenantId
    if (!tenantId) throw new ForbiddenException('Isletmeniz bulunmuyor')
    return this.service.getStorefront(tenantId)
  }

  @Put('admin/me/config')
  async updateMyConfig(@Req() req: any, @Body() body: { masaNumbers?: number[]; bannerUrl?: string }) {
    const tenantId = req.user?.tenantId
    if (!tenantId) throw new ForbiddenException('Isletmeniz bulunmuyor')
    await this.service.updateConfig(tenantId, body)
    return { success: true }
  }

  @Put('admin/me/banner')
  async updateMyBanner(@Req() req: any, @Body('bannerUrl') bannerUrl: string) {
    const tenantId = req.user?.tenantId
    if (!tenantId) throw new ForbiddenException('Isletmeniz bulunmuyor')
    await this.service.updateConfig(tenantId, { bannerUrl })
    return { success: true }
  }

  @Put('admin/me/logo')
  async updateMyLogo(@Req() req: any, @Body('logoUrl') logoUrl: string) {
    const tenantId = req.user?.tenantId
    if (!tenantId) throw new ForbiddenException('Isletmeniz bulunmuyor')
    await this.service.updateLogo(tenantId, logoUrl)
    return { success: true }
  }

  @Get('admin/:tenantId/products')
  async getProducts(@Req() req: any, @Param('tenantId') tenantId: string) {
    this.checkAccess(req, tenantId)
    return this.service.getProducts(tenantId)
  }

  @Post('admin/:tenantId/products')
  async addProduct(@Req() req: any, @Param('tenantId') tenantId: string, @Body() body: { name: string; price: number; description?: string; image?: string; category?: string }) {
    this.checkAccess(req, tenantId)
    return this.service.addProduct(tenantId, body)
  }

  @Put('admin/:tenantId/products/:productId')
  async updateProduct(@Req() req: any, @Param('tenantId') tenantId: string, @Param('productId') productId: string, @Body() body: any) {
    this.checkAccess(req, tenantId)
    return this.service.updateProduct(tenantId, productId, body)
  }

  @Delete('admin/:tenantId/products/:productId')
  async deleteProduct(@Req() req: any, @Param('tenantId') tenantId: string, @Param('productId') productId: string) {
    this.checkAccess(req, tenantId)
    await this.service.deleteProduct(tenantId, productId)
    return { success: true }
  }

  @Put('admin/:tenantId/config')
  async updateConfig(@Req() req: any, @Param('tenantId') tenantId: string, @Body() body: { masaNumbers?: number[]; bannerUrl?: string }) {
    this.checkAccess(req, tenantId)
    await this.service.updateConfig(tenantId, body)
    return { success: true }
  }

  private checkAccess(req: any, targetTenantId: string) {
    if (req.user?.role === 'SUPER_ADMIN') return
    if ((req.user?.role === 'BUSINESS_OWNER' || req.user?.role === 'ADMIN') && req.user?.tenantId === targetTenantId) return
    throw new ForbiddenException('Yetkiniz yok')
  }
}
