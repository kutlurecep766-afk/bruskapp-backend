import { Controller, Get, Post, Param, Query, Body, Req, Res, Headers, HttpCode, HttpStatus } from '@nestjs/common'
import { Request, Response } from 'express'
import { ZernioService } from './zernio.service'

@Controller('zernio')
export class ZernioController {
  constructor(private readonly zernio: ZernioService) {}

  @Get('connect/:platform')
  async connect(@Param('platform') platform: string, @Query('tenantId') tenantId: string) {
    if (!tenantId) return { success: false, message: 'tenantId gerekli' }
    const url = await this.zernio.getConnectUrl(tenantId, platform)
    if (url) return { success: true, url }
    return { success: false, message: 'Baglanti URL alinamadi' }
  }

  @Get('callback')
  async callback(
    @Query('tenantId') tenantId: string,
    @Query('platform') platform: string,
    @Query('code') code: string,
    @Query('error') error: string,
    @Query('error_description') errorDescription: string,
    @Query('profileId') profileId: string,
    @Query('tempToken') tempToken: string,
    @Query('step') step: string,
    @Query('connect_token') connectToken: string,
    @Query('userProfile') userProfile: string,
    @Res() res: Response,
  ) {
    const baseRedirect = '/brk-mgmt/chatbot-integrations'

    if (error || errorDescription) {
      this.zernio['logger'].warn('OAuth hatasi/i̇ptal: ' + (errorDescription || error || 'bilinmeyen'))
      return res.redirect(baseRedirect + '?error=' + encodeURIComponent(errorDescription || error || 'Baglanti iptal edildi'))
    }

    if (tempToken && profileId && platform) {
      const result = await this.zernio.handleHeadlessCallback({ profileId, tempToken, platform, step, connect_token: connectToken, userProfile })
      if (result.success) {
        return res.redirect(baseRedirect + '?connected=' + platform)
      }
      return res.redirect(baseRedirect + '?error=Baglanti%20kurulamadi')
    }

    if (tenantId && platform && code) {
      const ok = await this.zernio.handleCallback(tenantId, platform, code)
      if (ok) {
        return res.redirect(baseRedirect + '?connected=' + platform)
      }
      return res.redirect(baseRedirect + '?error=Baglanti%20kurulamadi')
    }

    res.redirect(baseRedirect)
  }

  @Get('connections')
  async connections(@Query('tenantId') tenantId?: string) {
    const data = await this.zernio.getConnections(tenantId)
    return { success: true, data }
  }

  @Post('disconnect')
  @HttpCode(HttpStatus.OK)
  async disconnect(@Body() body: { tenantId: string; platform: string }) {
    const ok = await this.zernio.disconnectPlatform(body.tenantId, body.platform)
    return { success: ok, message: ok ? 'Baglanti kaldirildi' : 'Baglanti bulunamadi' }
  }

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async webhook(@Req() req: Request, @Body() body: any, @Headers('x-zernio-signature') signature: string) {
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(body)
    const ok = await this.zernio.handleWebhook(body, rawBody, signature)
    if (!ok) return { received: false }
    return { received: true }
  }

  @Get('status')
  async status() {
    return { configured: this.zernio.isConfigured }
  }

  @Post('setup-webhook')
  async setupWebhook() {
    await this.zernio['ensureWebhook']()
    return { success: true, message: 'Webhook ayarlandi' }
  }
}
