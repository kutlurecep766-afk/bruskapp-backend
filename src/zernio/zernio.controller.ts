import { Controller, Get, Post, Param, Query, Body, Req, Res, HttpCode, HttpStatus } from '@nestjs/common'
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
  async callback(@Query('tenantId') tenantId: string, @Query('platform') platform: string, @Query('code') code: string, @Res() res: Response) {
    if (tenantId && platform && code) {
      await this.zernio.handleCallback(tenantId, platform, code)
    }
    res.redirect('/brk-mgmt/chatbot-integrations?connected=' + (platform || ''))
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
  async webhook(@Body() body: any) {
    await this.zernio.handleWebhook(body)
    return { received: true }
  }

  @Get('status')
  async status() {
    return { configured: this.zernio.isConfigured }
  }
}
