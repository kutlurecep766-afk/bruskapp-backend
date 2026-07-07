import { Controller, Post, Get, Param, Body, Query, Req, Logger, HttpException, HttpStatus } from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'
import { Public } from '../auth/public.decorator'
import { MarketplaceService } from './marketplace.service'

@SkipThrottle()
@Controller('marketplace')
export class MarketplaceController {
  private readonly logger = new Logger(MarketplaceController.name)

  constructor(private readonly marketplaceService: MarketplaceService) {}

  private extractTenant(req: any): string {
    return req.user?.tenantId || ''
  }

  @Get('platforms')
  getPlatforms() {
    return this.marketplaceService.getPlatformConfigs()
  }

  @Public()
  @Get('platforms/public')
  getPlatformConfigs() {
    return this.marketplaceService.getPlatformConfigs()
  }

  // Platform-specific routes for new providers
  // Old providers (trendyol, hepsiburada, yemeksepeti) handled by their own controllers

  @Post(':platform/connect')
  async connect(@Req() req: any, @Param('platform') platform: string, @Body() body: any) {
    const tenantId = this.extractTenant(req)
    if (!tenantId) return { success: false, message: 'Yetkilendirme hatasi' }
    return this.marketplaceService.connect(platform, tenantId, body)
  }

  @Post(':platform/disconnect')
  async disconnect(@Req() req: any, @Param('platform') platform: string) {
    const tenantId = this.extractTenant(req)
    if (!tenantId) return { success: false, message: 'Yetkilendirme hatasi' }
    return this.marketplaceService.disconnect(platform, tenantId)
  }

  @Get(':platform/status')
  async getStatus(@Req() req: any, @Param('platform') platform: string) {
    const tenantId = this.extractTenant(req)
    if (!tenantId) return { connected: false }
    return this.marketplaceService.getConnectionStatus(platform, tenantId)
  }

  @Public()
  @Post(':platform/test')
  async testConnection(@Param('platform') platform: string, @Body() body: any) {
    return this.marketplaceService.testConnection(platform, body)
  }

  @Get(':platform/products')
  async getProducts(@Req() req: any, @Param('platform') platform: string, @Query('page') page?: string, @Query('size') size?: string) {
    const tenantId = this.extractTenant(req)
    if (!tenantId) return { success: false, message: 'Yetkilendirme hatasi' }
    return this.marketplaceService.getProducts(platform, tenantId, parseInt(page || '0'), parseInt(size || '100'))
  }

  @Post(':platform/stock')
  async updateStock(@Req() req: any, @Param('platform') platform: string, @Body() body: { updates: { barcode: string; quantity: number }[] }) {
    const tenantId = this.extractTenant(req)
    if (!tenantId) return { success: false, message: 'Yetkilendirme hatasi' }
    return this.marketplaceService.updateStock(platform, tenantId, body.updates)
  }

  @Get(':platform/orders')
  async getOrders(@Req() req: any, @Param('platform') platform: string, @Query('page') page?: string, @Query('size') size?: string, @Query('status') status?: string) {
    const tenantId = this.extractTenant(req)
    if (!tenantId) return { success: false, message: 'Yetkilendirme hatasi' }
    return this.marketplaceService.getOrders(platform, tenantId, parseInt(page || '0'), parseInt(size || '50'), status)
  }

  @Get(':platform/orders/cached')
  async getCachedOrders(@Req() req: any, @Param('platform') platform: string, @Query('page') page?: string, @Query('size') size?: string) {
    const tenantId = this.extractTenant(req)
    if (!tenantId) return { success: false, message: 'Yetkilendirme hatasi' }
    return this.marketplaceService.getCachedOrders(platform, tenantId, parseInt(page || '0'), parseInt(size || '50'))
  }

  @Get(':platform/messages')
  async getMessages(@Req() req: any, @Param('platform') platform: string) {
    const tenantId = this.extractTenant(req)
    if (!tenantId) return { success: false, message: 'Yetkilendirme hatasi' }
    return this.marketplaceService.getMessages(platform, tenantId)
  }

  @Post(':platform/messages/:id/reply')
  async replyMessage(@Req() req: any, @Param('platform') platform: string, @Param('id') id: string, @Body() body: { message: string }) {
    const tenantId = this.extractTenant(req)
    if (!tenantId) return { success: false, message: 'Yetkilendirme hatasi' }
    return this.marketplaceService.replyMessage(platform, tenantId, id, body.message)
  }

  @Post(':platform/webhook/register')
  async registerWebhook(@Req() req: any, @Param('platform') platform: string, @Body() body: { url: string }) {
    const tenantId = this.extractTenant(req)
    if (!tenantId) return { success: false, message: 'Yetkilendirme hatasi' }
    return this.marketplaceService.registerWebhook(platform, tenantId, body.url)
  }

  @Public()
  @Post(':platform/webhook/callback/:tenantSlug')
  async webhookCallback(@Req() req: any, @Param('platform') platform: string, @Param('tenantSlug') tenantSlug: string, @Body() body: any) {
    const platformSignatureHeaders: Record<string, string> = {
      trendyol: 'x-trendyol-signature',
      hepsiburada: 'x-hb-signature',
      trendyolgo: 'x-getir-signature',
      yemeksepeti: 'x-yemeksepeti-signature',
      n11: 'x-n11-signature',
    }
    const signatureHeader = req.headers[platformSignatureHeaders[platform]] || req.headers['x-marketplace-signature'] || ''
    if (!signatureHeader) {
      this.logger.warn(`${platform} webhook: imza header'i eksik (tenant=${tenantSlug})`)
    }
    this.logger.log(`${platform} webhook: tenant=${tenantSlug}`)
    try {
      await this.marketplaceService.handleWebhook(platform, tenantSlug, body)
      return { success: true }
    } catch (e: any) {
      this.logger.error(`Webhook hatasi: ${e.message}`)
      return { success: false, message: e.message }
    }
  }
}
