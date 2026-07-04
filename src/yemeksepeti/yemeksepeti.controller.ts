import { Controller, Post, Get, Param, Body, Query, Req, Logger } from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'
import { Public } from '../auth/public.decorator'
import { YemeksepetiService } from './yemeksepeti.service'

@SkipThrottle()
@Controller('marketplace/yemeksepeti')
export class YemeksepetiController {
  private readonly logger = new Logger(YemeksepetiController.name)

  constructor(private readonly yemeksepetiService: YemeksepetiService) {}

  private extractTenant(req: any): string {
    return req.user?.tenantId || ''
  }

  @Post('connect')
  async connect(@Req() req: any, @Body() body: { clientId: string; clientSecret: string; restaurantId: string; testMode?: string }) {
    const tenantId = this.extractTenant(req)
    if (!tenantId) return { success: false, message: 'Yetkilendirme hatası' }
    return this.yemeksepetiService.connect(tenantId, body)
  }

  @Post('disconnect')
  async disconnect(@Req() req: any) {
    const tenantId = this.extractTenant(req)
    if (!tenantId) return { success: false, message: 'Yetkilendirme hatası' }
    return this.yemeksepetiService.disconnect(tenantId)
  }

  @Get('status')
  async getStatus(@Req() req: any) {
    const tenantId = this.extractTenant(req)
    if (!tenantId) return { connected: false }
    return this.yemeksepetiService.getConnectionStatus(tenantId)
  }

  @Public()
  @Post('test')
  async testConnection(@Body() body: { clientId: string; clientSecret: string; restaurantId: string; testMode?: string }) {
    return this.yemeksepetiService.testConnection(body as any)
  }

  @Get('products')
  async getProducts(@Req() req: any) {
    const tenantId = this.extractTenant(req)
    if (!tenantId) return { success: false, message: 'Yetkilendirme hatası' }
    return this.yemeksepetiService.getProducts(tenantId)
  }

  @Post('stock')
  async updateStock(@Req() req: any, @Body() body: { updates: { barcode: string; quantity: number }[] }) {
    const tenantId = this.extractTenant(req)
    if (!tenantId) return { success: false, message: 'Yetkilendirme hatası' }
    return this.yemeksepetiService.updateStock(tenantId, body.updates)
  }

  @Get('orders')
  async getOrders(@Req() req: any, @Query('page') page?: string, @Query('status') status?: string) {
    const tenantId = this.extractTenant(req)
    if (!tenantId) return { success: false, message: 'Yetkilendirme hatası' }
    return this.yemeksepetiService.getOrders(tenantId, parseInt(page || '0'), 50, status)
  }

  @Post('webhook/register')
  async registerWebhook(@Req() req: any, @Body() body: { url: string }) {
    const tenantId = this.extractTenant(req)
    if (!tenantId) return { success: false, message: 'Yetkilendirme hatası' }
    return this.yemeksepetiService.registerWebhook(tenantId, body.url)
  }

  @Public()
  @Post('webhook/callback/:tenantSlug')
  async webhookCallback(@Param('tenantSlug') tenantSlug: string, @Body() body: any) {
    this.logger.log('Yemeksepeti webhook: tenant=' + tenantSlug)
    try {
      await this.yemeksepetiService.handleWebhook(tenantSlug, body)
      return { success: true }
    } catch (e: any) {
      return { success: false, message: e.message }
    }
  }
}
