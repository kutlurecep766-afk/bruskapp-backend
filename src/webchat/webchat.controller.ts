import { Controller, Post, Get, Put, Body, Req, Query, Param } from '@nestjs/common'
import { WebchatService, ChatBotConfig } from './webchat.service'
import { Public } from '../auth/public.decorator'
import { WebchatMessageDto } from './webchat.dto'
import { Request } from 'express'

@Controller('webchat')
export class WebchatController {
  constructor(private webchat: WebchatService) {}

  @Public()
  @Post('message')
  async message(@Body() dto: WebchatMessageDto, @Req() req: Request): Promise<{ response: string }> {
    const sessionId = String(dto.sessionId || 'anon')
    const message = String(dto.message || '')
    const ip = (req.headers['x-forwarded-for'] as string || req.ip || '')?.split(',')[0]?.trim() || ''
    const response = await this.webchat.processMessage(sessionId, message, ip)
    return { response }
  }

  @Public()
  @Get('config/public')
  async getPublicConfig(@Query('slug') slug?: string): Promise<{ businessName: string; welcomeMessage: string; products: any[] }> {
    return this.webchat.getPublicConfig(slug || 'default')
  }

  @Get('config')
  async getConfig(@Req() req: any): Promise<ChatBotConfig> {
    const tenantId = req.user?.tenantId || 'default'
    return this.webchat.getConfig(tenantId)
  }

  @Put('config')
  async updateConfig(@Req() req: any, @Body() body: Partial<ChatBotConfig>): Promise<ChatBotConfig> {
    const tenantId = req.user?.tenantId || 'default'
    return this.webchat.updateConfig(tenantId, body)
  }
}
