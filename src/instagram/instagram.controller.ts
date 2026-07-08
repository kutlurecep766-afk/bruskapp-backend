import { Controller, Post, Get, Body, Query, Req, ForbiddenException, Header } from '@nestjs/common'
import { Public } from '../auth/public.decorator'
import { InstagramService } from './instagram.service'
import { MessagesService } from '../messages/messages.service'

@Controller('instagram')
export class InstagramController {
  constructor(
    private readonly instagramService: InstagramService,
    private readonly messagesService: MessagesService,
  ) {}

  @Get('config')
  async getConfig(@Req() req: any) {
    const tenantId = req.user?.tenantId
    if (!tenantId) throw new ForbiddenException('Yetkiniz yok')
    const config = await this.instagramService.getConfig(tenantId)
    const proto = req.headers['x-forwarded-proto'] || req.protocol
    const webhookUrl = `${proto}://${req.get('host')}/api/instagram/webhook`
    return { config, webhookUrl }
  }

  @Post('config')
  async saveConfig(@Req() req: any, @Body() body: { accessToken: string; igBusinessAccountId: string; webhookToken: string; active?: boolean }) {
    const tenantId = req.user?.tenantId
    if (!tenantId) throw new ForbiddenException('Yetkiniz yok')
    return this.instagramService.saveConfig(tenantId, body)
  }

  @Post('test')
  async testConnection(@Req() req: any) {
    const tenantId = req.user?.tenantId
    if (!tenantId) throw new ForbiddenException('Yetkiniz yok')
    return this.instagramService.testConnection(tenantId)
  }

  @Post('send')
  async sendMessage(@Req() req: any, @Body() body: { to: string; message: string }) {
    const tenantId = req.user?.tenantId
    if (!tenantId) throw new ForbiddenException('Yetkiniz yok')
    return this.instagramService.sendMessage(tenantId, body.to, body.message)
  }

  @Public()
  @Get('webhook')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  async verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ) {
    if (mode === 'subscribe' && token) {
      const config = await this.instagramService.findByWebhookToken(token)
      if (config) return challenge
    }
    return 'Verification failed'
  }

  @Public()
  @Post('webhook')
  async incomingWebhook(@Req() req: any) {
    const body = req.body
    const entries = body?.entry || []
    for (const entry of entries) {
      const igBusinessAccountId = entry.id
      if (!igBusinessAccountId) continue

      const config = await this.instagramService.findByIgBusinessAccountId(igBusinessAccountId)
      if (!config) continue

      const messaging = entry.messaging || []
      for (const event of messaging) {
        const senderId = event.sender?.id
        const msg = event.message
        if (senderId && msg?.text) {
          await this.messagesService.create({
            platform: 'instagram',
            from: senderId,
            content: msg.text,
            messageId: msg.mid || Date.now().toString(),
            tenantId: config.tenantId,
            direction: 'incoming',
          })
        }
      }
    }
    return { status: 'ok' }
  }
}
