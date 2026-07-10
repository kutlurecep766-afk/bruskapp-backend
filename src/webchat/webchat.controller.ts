import { Controller, Post, Get, Put, Body, Req, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { diskStorage } from 'multer'
import * as path from 'path'
import * as fs from 'fs'
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

  @Post('logo')
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({
      destination: path.join(process.cwd(), 'data', 'uploads'),
      filename: (req, file, cb) => cb(null, 'chatbot-logo' + path.extname(file.originalname)),
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      if (!file.mimetype.startsWith('image/')) cb(new BadRequestException('Sadece resim dosyalari'), false)
      else cb(null, true)
    },
  }))
  async uploadLogo(@Req() req: any, @UploadedFile() file: any) {
    if (!file) throw new BadRequestException('Dosya gerekli')
    const proto = req.headers['x-forwarded-proto'] || 'https'
    const host = req.get('host') || 'bruskapp.com'
    const logoUrl = `${proto}://${host}/api/uploads/chatbot-logo${path.extname(file.originalname)}`
    this.webchat.updateConfig({ logoUrl })
    return { success: true, logoUrl }
  }
}
