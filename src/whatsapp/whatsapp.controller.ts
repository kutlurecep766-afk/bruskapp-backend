import { Controller, Post, Get, Body, Query, Req, ForbiddenException } from '@nestjs/common'
import { Public } from '../auth/public.decorator'
import { WhatsappService } from './whatsapp.service'
import { MessagesService } from '../messages/messages.service'
import { SaveWhatsAppConfigDto, WhatsappSendDto } from './whatsapp.dto'

@Controller('whatsapp')
export class WhatsappController {
  constructor(
    private readonly whatsappService: WhatsappService,
    private readonly messagesService: MessagesService,
  ) {}

  @Get('config')
  async getConfig(@Req() req: any) {
    const tenantId = req.user?.tenantId
    if (!tenantId) throw new ForbiddenException('Yetkiniz yok')
    const config = await this.whatsappService.getConfig(tenantId)
    const webhookUrl = `${req.protocol}://${req.get('host')}/whatsapp/webhook`
    return { config, webhookUrl }
  }

  @Post('config')
  async saveConfig(@Req() req: any, @Body() body: SaveWhatsAppConfigDto) {
    const tenantId = req.user?.tenantId
    if (!tenantId) throw new ForbiddenException('Yetkiniz yok')
    return this.whatsappService.saveConfig(tenantId, body)
  }

  @Post('test')
  async testConnection(@Req() req: any) {
    const tenantId = req.user?.tenantId
    if (!tenantId) throw new ForbiddenException('Yetkiniz yok')
    return this.whatsappService.testConnection(tenantId)
  }

  @Post('send')
  async sendMessage(@Req() req: any, @Body() dto: WhatsappSendDto) {
    const tenantId = req.user?.tenantId
    if (!tenantId) throw new ForbiddenException('Yetkiniz yok')
    return this.whatsappService.sendMessage(tenantId, dto.to, dto.message)
  }

  @Public()
  @Get('webhook')
  async verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ) {
    if (mode === 'subscribe' && token) {
      const config = await this.whatsappService.findByWebhookToken(token)
      if (config) return challenge
    }
    return 'Verification failed'
  }

  @Public()
  @Post('webhook')
  async incomingWebhook(@Req() req: any) {
    const body = req.body
    const entry = body?.entry?.[0]
    if (!entry) return { status: 'ok' }

    const changes = entry.changes?.[0]?.value
    if (!changes) return { status: 'ok' }

    const phoneNumberId = changes.metadata?.phone_number_id
    if (!phoneNumberId) return { status: 'ok' }

    const config = await this.whatsappService.findByPhoneNumberId(phoneNumberId)
    if (!config) return { status: 'ok' }

    const messages = changes.messages || []
    for (const msg of messages) {
      await this.messagesService.create({
        platform: 'whatsapp',
        from: msg.from || 'unknown',
        content: msg.text?.body || '(media)',
        messageId: msg.id,
        tenantId: config.tenantId,
        direction: 'incoming',
      })
    }
    return { status: 'ok' }
  }
}
