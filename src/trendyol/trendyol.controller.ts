import { Controller, Post, Get, Param, Body, Query, Req, Logger } from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'
import { Public } from '../auth/public.decorator'
import { TrendyolService } from './trendyol.service'

@SkipThrottle()
@Controller('marketplace/trendyol')
export class TrendyolController {
  private readonly logger = new Logger(TrendyolController.name)

  constructor(private readonly trendyolService: TrendyolService) {}

  private extractTenant(req: any): string {
    return req.user?.tenantId || ''
  }

  @Post('connect')
  async connect(@Req() req: any, @Body() body: { apiKey: string; apiSecret: string; supplierId: string }) {
    const tenantId = this.extractTenant(req)
    if (!tenantId) return { success: false, message: 'Yetkilendirme hatasi' }
    return this.trendyolService.connect(tenantId, body)
  }

  @Post('disconnect')
  async disconnect(@Req() req: any) {
    const tenantId = this.extractTenant(req)
    if (!tenantId) return { success: false, message: 'Yetkilendirme hatasi' }
    return this.trendyolService.disconnect(tenantId)
  }

  @Get('status')
  async getStatus(@Req() req: any) {
    const tenantId = this.extractTenant(req)
    if (!tenantId) return { connected: false }
    return this.trendyolService.getConnectionStatus(tenantId)
  }

  @Public()
  @Post('test')
  async testConnection(@Body() body: { apiKey: string; apiSecret: string; supplierId: string }) {
    return this.trendyolService.testConnection(body)
  }

  @Get('products')
  async getProducts(@Req() req: any, @Query('page') page?: string, @Query('size') size?: string) {
    const tenantId = this.extractTenant(req)
    if (!tenantId) return { success: false, message: 'Yetkilendirme hatasi' }
    return this.trendyolService.getProducts(tenantId, parseInt(page || '0'), parseInt(size || '100'))
  }

  @Post('stock')
  async updateStock(@Req() req: any, @Body() body: { updates: { barcode: string; quantity: number }[] }) {
    const tenantId = this.extractTenant(req)
    if (!tenantId) return { success: false, message: 'Yetkilendirme hatasi' }
    return this.trendyolService.updateStock(tenantId, body.updates)
  }

  @Get('orders')
  async getOrders(@Req() req: any, @Query('page') page?: string, @Query('size') size?: string, @Query('status') status?: string) {
    const tenantId = this.extractTenant(req)
    if (!tenantId) return { success: false, message: 'Yetkilendirme hatasi' }
    return this.trendyolService.getOrders(tenantId, parseInt(page || '0'), parseInt(size || '50'), status)
  }

  @Get('messages')
  async getMessages(@Req() req: any) {
    const tenantId = this.extractTenant(req)
    if (!tenantId) return { success: false, message: 'Yetkilendirme hatasi' }
    return this.trendyolService.getMessages(tenantId)
  }

  @Post('messages/:id/reply')
  async replyMessage(@Req() req: any, @Param('id') id: string, @Body() body: { message: string }) {
    const tenantId = this.extractTenant(req)
    if (!tenantId) return { success: false, message: 'Yetkilendirme hatasi' }
    return this.trendyolService.replyMessage(tenantId, id, body.message)
  }

  @Post('webhook/register')
  async registerWebhook(@Req() req: any, @Body() body: { url: string }) {
    const tenantId = this.extractTenant(req)
    if (!tenantId) return { success: false, message: 'Yetkilendirme hatasi' }
    return this.trendyolService.registerWebhook(tenantId, body.url)
  }

  @Public()
  @Post('webhook/callback/:tenantSlug')
  async webhookCallback(@Param('tenantSlug') tenantSlug: string, @Body() body: any) {
    this.logger.log('Trendyol webhook: tenant=' + tenantSlug + ' type=' + (body?.type || 'unknown'))
    try {
      await this.trendyolService.handleWebhook(tenantSlug, body)
      return { success: true }
    } catch (e: any) {
      this.logger.error('Webhook hatasi:', e.message)
      return { success: false, message: e.message }
    }
  }
}