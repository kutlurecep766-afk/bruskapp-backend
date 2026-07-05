import { Controller, Post, Get, Param, Body, Query, Req, Logger } from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'
import { Public } from '../auth/public.decorator'
import { HepsiburadaService } from './hepsiburada.service'

@SkipThrottle()
@Controller('marketplace/hepsiburada')
export class HepsiburadaController {
  private readonly logger = new Logger(HepsiburadaController.name)

  constructor(private readonly hepsiburadaService: HepsiburadaService) {}

  private extractTenant(req: any): string {
    return req.user?.tenantId || ''
  }

  @Post('connect')
  async connect(@Req() req: any, @Body() body: { apiKey: string; apiSecret: string; merchantId: string }) {
    const tenantId = this.extractTenant(req)
    if (!tenantId) return { success: false, message: 'Yetkilendirme hatasi' }
    return this.hepsiburadaService.connect(tenantId, body)
  }

  @Post('disconnect')
  async disconnect(@Req() req: any) {
    const tenantId = this.extractTenant(req)
    if (!tenantId) return { success: false, message: 'Yetkilendirme hatasi' }
    return this.hepsiburadaService.disconnect(tenantId)
  }

  @Get('status')
  async getStatus(@Req() req: any) {
    const tenantId = this.extractTenant(req)
    if (!tenantId) return { connected: false }
    return this.hepsiburadaService.getConnectionStatus(tenantId)
  }

  @Public()
  @Post('test')
  async testConnection(@Body() body: { apiKey: string; apiSecret: string; merchantId: string }) {
    return this.hepsiburadaService.testConnection(body)
  }

  @Get('products')
  async getProducts(@Req() req: any, @Query('page') page?: string, @Query('size') size?: string) {
    const tenantId = this.extractTenant(req)
    if (!tenantId) return { success: false, message: 'Yetkilendirme hatasi' }
    return this.hepsiburadaService.getProducts(tenantId, parseInt(page || '0'), parseInt(size || '100'))
  }

  @Post('stock')
  async updateStock(@Req() req: any, @Body() body: { updates: { barcode: string; quantity: number }[] }) {
    const tenantId = this.extractTenant(req)
    if (!tenantId) return { success: false, message: 'Yetkilendirme hatasi' }
    return this.hepsiburadaService.updateStock(tenantId, body.updates)
  }

  @Get('stock/:trackingId')
  async checkBulkStockStatus(@Req() req: any, @Param('trackingId') trackingId: string) {
    const tenantId = this.extractTenant(req)
    if (!tenantId) return { success: false, message: 'Yetkilendirme hatasi' }
    return this.hepsiburadaService.checkBulkStockStatus(tenantId, trackingId)
  }

  @Get('orders')
  async getOrders(@Req() req: any, @Query('page') page?: string, @Query('size') size?: string, @Query('status') status?: string) {
    const tenantId = this.extractTenant(req)
    if (!tenantId) return { success: false, message: 'Yetkilendirme hatasi' }
    return this.hepsiburadaService.getOrders(tenantId, parseInt(page || '0'), parseInt(size || '50'), status)
  }

  @Public()
  @Post('webhook/callback/:tenantSlug')
  async webhookCallback(@Param('tenantSlug') tenantSlug: string, @Body() body: any) {
    this.logger.log('Hepsiburada webhook: tenant=' + tenantSlug + ' type=' + (body?.type || 'unknown'))
    try {
      await this.hepsiburadaService.handleWebhook(tenantSlug, body)
      return { success: true }
    } catch (e: any) {
      this.logger.error('Webhook hatasi:', e.message)
      return { success: false, message: e.message }
    }
  }
}
