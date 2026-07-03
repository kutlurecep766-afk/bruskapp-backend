import { Controller, Post, Get, Body, Query, Req } from '@nestjs/common'
import { Public } from '../auth/public.decorator'
import { WhatsappService } from './whatsapp.service'
import { MessagesService } from '../messages/messages.service'
import { PrismaService } from '../prisma.service'
import { WhatsappSendDto } from './whatsapp.dto'

@Controller('whatsapp')
export class WhatsappController {
  constructor(
    private readonly whatsappService: WhatsappService,
    private readonly messagesService: MessagesService,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Post('test')
  async testConnection() {
    return this.whatsappService.testConnection()
  }

  @Public()
  @Post('send')
  async sendMessage(@Body() dto: WhatsappSendDto) {
    return this.whatsappService.sendMessage(dto.to, dto.message)
  }

  @Public()
  @Get('webhook')
  async verifyWebhook(@Query('hub.mode') mode: string, @Query('hub.verify_token') token: string, @Query('hub.challenge') challenge: string) {
    if (mode === 'subscribe' && token === 'bruskapp_verify_2024') {
      return challenge
    }
    return 'Verification failed'
  }

  @Public()
  @Post('webhook')
  async incomingWebhook(@Req() req: any) {
    const body = req.body
    if (body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
      const msg = body.entry[0].changes[0].value.messages[0]
      await this.messagesService.create({
        platform: 'whatsapp',
        from: msg.from || 'unknown',
        content: msg.text?.body || '(media)',
        messageId: msg.id,
        tenantId: (await this.prisma.tenant.findFirst({ where: { slug: 'default' }, select: { id: true } }))?.id || 'default',
      })
    }
    return { status: 'ok' }
  }
}
