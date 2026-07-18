import { Controller, Post, Get, Body, Query, Req, ForbiddenException, Header, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { diskStorage } from 'multer'
import * as path from 'path'
import { Public } from '../auth/public.decorator'
import { WhatsappService } from './whatsapp.service'
import { MessagesService } from '../messages/messages.service'
import { WebchatService } from '../webchat/webchat.service'
import { PrismaService } from '../prisma.service'
import { SaveWhatsAppConfigDto, WhatsappSendDto } from './whatsapp.dto'

@Controller('whatsapp')
export class WhatsappController {
  constructor(
    private readonly whatsappService: WhatsappService,
    private readonly messagesService: MessagesService,
    private readonly webchatService: WebchatService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('config')
  async getConfig(@Req() req: any) {
    const tenantId = req.user?.tenantId
    if (!tenantId) throw new ForbiddenException('Yetkiniz yok')
    const config = await this.whatsappService.getConfig(tenantId)
    const proto = req.headers['x-forwarded-proto'] || req.protocol
    const webhookUrl = `${proto}://${req.get('host')}/api/whatsapp/webhook`
    return { config, webhookUrl }
  }

  @Post('config')
  async saveConfig(@Req() req: any, @Body() body: SaveWhatsAppConfigDto) {
    const tenantId = req.user?.tenantId
    if (!tenantId) throw new ForbiddenException('Yetkiniz yok')
    return this.whatsappService.saveConfig(tenantId, body)
  }

  @Post('ai/pause')
  async aiPause(@Req() req: any, @Body('from') from: string) {
    const user = req.user as any
    if (!user || !from) throw new ForbiddenException('Yetkiniz yok')
    const tenant = await this.prisma.tenant.findFirst({
      where: { users: { some: { id: user.userId } } },
      select: { id: true },
    })
    if (!tenant) throw new ForbiddenException('Isletme bulunamadi')
    this.whatsappService.setAiPaused(tenant.id, from, true)
    return { status: 'paused' }
  }

  @Post('ai/resume')
  async aiResume(@Req() req: any, @Body('from') from: string) {
    const user = req.user as any
    if (!user || !from) throw new ForbiddenException('Yetkiniz yok')
    const tenant = await this.prisma.tenant.findFirst({
      where: { users: { some: { id: user.userId } } },
      select: { id: true },
    })
    if (!tenant) throw new ForbiddenException('Isletme bulunamadi')
    this.whatsappService.setAiPaused(tenant.id, from, false)
    return { status: 'resumed' }
  }

  @Get('ai/status')
  async aiStatus(@Req() req: any, @Query('from') from: string) {
    const user = req.user as any
    if (!user || !from) return { paused: false }
    const tenant = await this.prisma.tenant.findFirst({
      where: { users: { some: { id: user.userId } } },
      select: { id: true },
    })
    if (!tenant) return { paused: false }
    return { paused: this.whatsappService.isAiPaused(tenant.id, from) }
  }

  @Get('profile')
  async getProfile(@Req() req: any) {
    const tenantId = req.user?.tenantId
    if (!tenantId) throw new ForbiddenException('Yetkiniz yok')
    return this.whatsappService.getProfile(tenantId)
  }

  @Post('profile')
  async updateProfile(@Req() req: any, @Body() body: { about?: string; description?: string; email?: string; websites?: string[] }) {
    const tenantId = req.user?.tenantId
    if (!tenantId) throw new ForbiddenException('Yetkiniz yok')
    return this.whatsappService.updateProfile(tenantId, body)
  }

  @Post('profile/picture')
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({
      destination: '/tmp',
      filename: (req, file, cb) => cb(null, 'wa-profile-' + Date.now() + path.extname(file.originalname)),
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      if (!file.mimetype.startsWith('image/')) cb(new BadRequestException('Sadece resim dosyalari'), false)
      else cb(null, true)
    },
  }))
  async uploadProfilePicture(@Req() req: any, @UploadedFile() file: any) {
    const tenantId = req.user?.tenantId
    if (!tenantId) throw new ForbiddenException('Yetkiniz yok')
    if (!file) throw new BadRequestException('Dosya gerekli')
    return this.whatsappService.uploadProfilePicture(tenantId, file.path, file.mimetype)
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
    const result = await this.whatsappService.sendMessage(tenantId, dto.to, dto.message)
    if (result.success) {
      const msgId = result.messageId
      await this.messagesService.create({
        platform: 'whatsapp', from: dto.to.replace(/[^0-9]/g, ''), content: dto.message, tenantId, direction: 'outgoing',
        messageId: msgId, status: 'sent',
      }).catch(() => {})
    }
    return result
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
    const tenantId = config.tenantId

    // handle delivery/read status updates
    const statuses = changes.statuses || []
    for (const st of statuses) {
      const stMsgId = st.id
      if (!stMsgId) continue
      if (st.status === 'delivered' || st.status === 'read') {
        if (st.status === 'read') {
          this.messagesService.updateStatus(stMsgId, 'read').catch(() => {})
        } else if (st.status === 'delivered') {
          this.messagesService.updateStatus(stMsgId, 'delivered').catch(() => {})
        }
      }
    }

    const messages = changes.messages || []
    for (const msg of messages) {
      if (msg.direction === 'send') continue // skip echoes

      if (!msg.text?.body) continue

      const text = msg.text.body
      const from = msg.from || 'unknown'

      await this.messagesService.create({
        platform: 'whatsapp', from, content: text, messageId: msg.id, tenantId, direction: 'incoming',
      })

      // AI auto-reply
      if (!this.whatsappService.isAiPaused(tenantId, from)) {
        ;(async () => {
          try {
            const tenantData = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { features: true } })
            const feats = (tenantData?.features as any) || {}
            if (feats.aiAutoReply === false) return
            const limit = feats.messageLimit || 0

            if (limit > 0) {
              const startOfMonth = new Date()
              startOfMonth.setDate(1)
              startOfMonth.setHours(0, 0, 0, 0)
              const monthCount = await this.prisma.message.count({
                where: { tenantId, direction: 'outgoing', createdAt: { gte: startOfMonth } },
              })
              if (monthCount >= limit) return
            }

            // markAsRead + typing (Meta standart bilesik istek)
            if (msg.id) {
              this.whatsappService.markAsRead(tenantId, msg.id, true)
            }

            const reply = await this.webchatService.generatePlatformResponse(tenantId, "whatsapp", from, text)
            if (reply && msg.id) {
              const sendResult = await this.whatsappService.sendMessage(tenantId, from, reply)
              const aiMsgId = sendResult.messageId
              await this.messagesService.create({
                platform: 'whatsapp', from, content: reply, tenantId, direction: 'outgoing',
                messageId: aiMsgId, status: 'sent',
              }).catch(() => {})
            }
          } catch (e) {
            console.error('WhatsApp AI reply error:', e)
          }
        })()
      }
    }
    return { status: 'ok' }
  }
}
