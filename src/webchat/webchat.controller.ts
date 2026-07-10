import { Controller, Post, Get, Put, Body, Req } from '@nestjs/common'
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
  async getPublicConfig(): Promise<{ businessName: string; welcomeMessage: string; products: any[] }> {
    const config = this.webchat.getConfig()
    return {
      businessName: config.businessName,
      welcomeMessage: config.welcomeMessage,
      products: config.products,
    }
  }

  @Get('config')
  async getConfig(): Promise<ChatBotConfig> {
    return this.webchat.getConfig()
  }

  @Put('config')
  async updateConfig(@Body() body: Partial<ChatBotConfig>): Promise<ChatBotConfig> {
    return this.webchat.updateConfig(body)
  }
}
