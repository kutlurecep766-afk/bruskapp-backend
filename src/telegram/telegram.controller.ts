import { Controller, Post, Get, Body, Req } from '@nestjs/common'
import { Public } from '../auth/public.decorator'
import { TelegramService } from './telegram.service'
import { MessagesService } from '../messages/messages.service'
import { PrismaService } from '../prisma.service'
import { TelegramSendDto } from './telegram.dto'

@Controller('telegram')
export class TelegramController {
  constructor(
    private readonly telegramService: TelegramService,
    private readonly messagesService: MessagesService,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Get('status')
  async getStatus() {
    return { configured: this.telegramService.isConfigured, botInfo: await this.telegramService.getBotInfo().catch(() => null) }
  }

  @Public()
  @Post('test')
  async testConnection(@Body() body: { token?: string }) {
    return this.telegramService.testConnection(body.token)
  }

  @Public()
  @Post('save-token')
  async saveToken(@Body() body: { token: string }) {
    if (!body.token) return { success: false, message: 'Token gerekli' }
    return this.telegramService.saveToken(body.token)
  }

  @Public()
  @Post('webhook-setup')
  async setupWebhook() {
    return this.telegramService.setWebhook()
  }

  @Public()
  @Post('send')
  async sendMessage(@Body() dto: TelegramSendDto) {
    const ok = await this.telegramService.sendMessage(dto.chatId, dto.message)
    return { success: ok, message: ok ? 'Mesaj gonderildi' : 'Gonderim hatasi' }
  }

  @Public()
  @Post('webhook')
  async incomingWebhook(@Req() req: any) {
    const body = req.body
    if (body?.message) {
      const msg = body.message
      const chatId = msg.chat?.id?.toString()
      const from = msg.from?.username || msg.from?.id?.toString() || 'unknown'
      const content = msg.text || '(media)'

      await this.messagesService.create({
        platform: 'telegram',
        from,
        content,
        messageId: msg.message_id?.toString(),
        tenantId: (await this.prisma.tenant.findFirst({ where: { slug: 'default' }, select: { id: true } }))?.id || 'default',
      })

      if (chatId && msg.text) {
        await this.telegramService.autoReply(chatId, msg.text)
      }
    }
    return { status: 'ok' }
  }

  @Public()
  @Post('tenant-connect')
  async tenantConnect(@Body() body: { tenantId: string; token: string }) {
    return this.telegramService.connectTenantBot(body.tenantId, body.token)
  }

  @Public()
  @Post('tenant-disconnect')
  async tenantDisconnect(@Body() body: { tenantId: string }) {
    return this.telegramService.disconnectTenantBot(body.tenantId)
  }

  @Public()
  @Post('tenant-status')
  async tenantStatus(@Body() body: { tenantId: string }) {
    if (!body.tenantId) return { connected: false, botInfo: null }
    return this.telegramService.getTenantBotStatus(body.tenantId)
  }

  @Public()
  @Post('webhook/:tenantId')
  async tenantWebhook(@Param('tenantId') tenantId: string, @Req() req: any) {
    await this.telegramService.handleTenantWebhook(tenantId, req.body)
    return { status: 'ok' }
  }

  @Public()
  @Get('polling-status')
  async getPollingStatus() {
    return this.telegramService.getPollingStatus()
  }

  @Public()
  @Post('toggle')
  async toggleBot() {
    return this.telegramService.togglePolling()
  }

  @Public()
  @Get('deepseek-status')
  async getDeepSeekStatus() {
    return this.telegramService.getDeepSeekStatus()
  }

  @Public()
  @Post('deepseek-toggle')
  async toggleDeepSeek() {
    return this.telegramService.toggleDeepSeek()
  }
}
