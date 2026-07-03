import { Controller, Post, Get, Body, Req } from '@nestjs/common'
import { Public } from '../auth/public.decorator'
import { InstagramService } from './instagram.service'
import { MessagesService } from '../messages/messages.service'
import { PrismaService } from '../prisma.service'

@Controller('instagram')
export class InstagramController {
  constructor(
    private readonly instagramService: InstagramService,
    private readonly messagesService: MessagesService,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Get('status')
  async getStatus() {
    return { configured: !!this.instagramService['isConfigured'] }
  }

  @Public()
  @Post('test')
  async testConnection(@Body() body: { userId?: string; token?: string }) {
    return this.instagramService.testConnection(body.token, body.userId)
  }

  @Public()
  @Post('save-config')
  async saveConfig(@Body() body: { userId: string; token: string }) {
    return this.instagramService.saveConfig(body.userId, body.token)
  }

  @Public()
  @Post('send')
  async sendMessage(@Body() body: { to: string; message: string }) {
    return this.instagramService.sendMessage(body.to, body.message)
  }

  @Public()
  @Post('webhook')
  async incomingWebhook(@Req() req: any) {
    const body = req.body
    const entries = body?.entry || []
    for (const entry of entries) {
      const messaging = entry.messaging || []
      for (const event of messaging) {
        const senderId = event.sender?.id
        const msg = event.message
        if (senderId && msg?.text) {
          const tenant = await this.prisma.tenant.findFirst({ where: { slug: 'default' }, select: { id: true } })
          await this.messagesService.create({
            platform: 'instagram',
            from: senderId,
            content: msg.text,
            messageId: msg.mid || Date.now().toString(),
            tenantId: tenant?.id || 'default',
            direction: 'incoming',
          })
        }
      }
    }
    return { status: 'ok' }
  }
}
