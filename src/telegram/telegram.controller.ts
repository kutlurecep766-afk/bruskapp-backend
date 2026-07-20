import { Controller, Post, Get, Param, Body, Req, ForbiddenException } from '@nestjs/common'
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

  @Post('send')
  async sendMessage(@Req() req: any, @Body() dto: TelegramSendDto) {
    const tenantId = req.user?.tenantId
    if (!tenantId) throw new ForbiddenException('Yetkiniz yok')
    const ok = await this.telegramService.sendTenantMessage(tenantId, dto.chatId, dto.message)
    if (ok && this.messagesService) {
      await this.messagesService.create({
        platform: 'telegram',
        from: dto.chatId,
        content: dto.message,
        messageId: 'out_' + Date.now().toString(),
        tenantId,
        direction: 'outgoing',
      }).catch(() => {})
    }
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

  @Post('tenant-connect')
  async tenantConnect(@Req() req: any, @Body() body: { token: string; tenantId?: string }) {
    const tenantId = body.tenantId || req.user?.tenantId
    if (!tenantId) return { success: false, message: 'Yetkilendirme gerekli' }
    if (body.tenantId && req.user?.role !== 'SUPER_ADMIN') return { success: false, message: 'Bu islem icin super admin yetkisi gerekli' }
    if (!body.token) return { success: false, message: 'Token gerekli' }
    if (body.token === this.telegramService.getMainBotToken()) {
      return { success: false, message: 'Ana bot tokeni tenant botu olarak kullanilamaz' }
    }
    return this.telegramService.connectTenantBot(tenantId, body.token)
  }

  @Post('tenant-disconnect')
  async tenantDisconnect(@Req() req: any, @Body() body: { tenantId?: string }) {
    const tenantId = body.tenantId || req.user?.tenantId
    if (!tenantId) return { success: false, message: 'Yetkilendirme gerekli' }
    if (body.tenantId && req.user?.role !== 'SUPER_ADMIN') return { success: false, message: 'Bu islem icin super admin yetkisi gerekli' }
    return this.telegramService.disconnectTenantBot(tenantId)
  }

  @Post('tenant-status')
  async tenantStatus(@Req() req: any, @Body() body: { tenantId?: string }) {
    const tenantId = body.tenantId || req.user?.tenantId
    if (!tenantId) return { connected: false, botInfo: null }
    const isAdmin = req.user?.role === 'SUPER_ADMIN'
    return this.telegramService.getTenantBotStatus(tenantId, isAdmin)
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
