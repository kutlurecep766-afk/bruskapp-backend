import { Controller, Post, Get, Body, Query, Req, ForbiddenException, Header } from '@nestjs/common'
import { Public } from '../auth/public.decorator'
import { InstagramService } from './instagram.service'
import { MessagesService } from '../messages/messages.service'
import { WebchatService } from '../webchat/webchat.service'
import { PrismaService } from '../prisma.service'

@Controller('instagram')
export class InstagramController {
  constructor(
    private readonly instagramService: InstagramService,
    private readonly messagesService: MessagesService,
    private readonly webchatService: WebchatService,
    private readonly prisma: PrismaService,
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

  @Post('ai/pause')
  async aiPause(@Req() req: any, @Body('from') from: string) {
    const user = req.user as any
    if (!user || !from) throw new ForbiddenException('Yetkiniz yok')
    const tenant = await this.prisma.tenant.findFirst({
      where: { users: { some: { id: user.userId } } },
      select: { id: true },
    })
    if (!tenant) throw new ForbiddenException('Isletme bulunamadi')
    this.instagramService.setAiPaused(tenant.id, from, true)
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
    this.instagramService.setAiPaused(tenant.id, from, false)
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
    return { paused: this.instagramService.isAiPaused(tenant.id, from) }
  }

  @Post('test')
  async testConnection(@Req() req: any) {
    const tenantId = req.user?.tenantId
    if (!tenantId) throw new ForbiddenException('Yetkiniz yok')
    return this.instagramService.testConnection(tenantId)
  }

  @Post('send')
  async sendMessage(@Req() req: any, @Body() dto: { to: string; message: string }) {
    const tenantId = req.user?.tenantId
    if (!tenantId) throw new ForbiddenException('Yetkiniz yok')
    const result = await this.instagramService.sendMessage(tenantId, dto.to, dto.message)
    if (result.success) {
      const saved = await this.messagesService.create({
        platform: 'instagram', from: dto.to, content: dto.message, tenantId, direction: 'outgoing', status: 'sent',
      }).catch(e => { console.error('Instagram save error:', e); return null })
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
      const tenantId = config.tenantId

      const messaging = entry.messaging || []
      for (const event of messaging) {
        const senderId = event.sender?.id
        const msg = event.message
        if (!senderId || (!msg?.text && !msg?.attachments)) continue

        // skip echoes (messages we sent ourselves)
        if (msg.is_echo) continue

        // fetch username
        const username = await this.instagramService.getUsername(tenantId, senderId).catch(() => null)

        // Extract text and image
        const msgText = msg?.text || ''
        let imageBase64: string | undefined
        let imageMime: string | undefined
        if (msg?.attachments?.length) {
          for (const att of msg.attachments) {
            if (att.type === 'image' && att.payload?.url) {
              try {
                const res = await fetch(att.payload.url)
                if (res.ok) {
                  const buf = Buffer.from(await res.arrayBuffer())
                  imageBase64 = buf.toString('base64')
                  imageMime = res.headers.get('content-type') || 'image/jpeg'
                }
              } catch {}
              break
            }
          }
        }

        const displayContent = msgText || '(media)'
        await this.messagesService.create({
          platform: 'instagram',
          from: senderId,
          content: displayContent,
          messageId: msg.mid || Date.now().toString(),
          tenantId,
          direction: 'incoming',
          fromName: username || undefined,
        })

        // AI auto-reply
        if (!this.instagramService.isAiPaused(tenantId, senderId)) {
          try {
            const tenantData = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { features: true } })
            const feats = (tenantData?.features as any) || {}
            if (feats.aiAutoReply === false) continue
            const limit = feats.messageLimit || 0

            if (limit > 0) {
              const startOfMonth = new Date()
              startOfMonth.setDate(1)
              startOfMonth.setHours(0, 0, 0, 0)
              const monthCount = await this.prisma.message.count({
                where: { tenantId, direction: 'outgoing', createdAt: { gte: startOfMonth } },
              })
              if (monthCount >= limit) continue
            }

            const reply = imageBase64
              ? await this.webchatService.generateMultimodalResponse(msgText, imageBase64, imageMime!)
              : msgText
                ? await this.webchatService.generateResponse(msgText)
                : null

            if (reply) {
              await this.instagramService.sendMessage(tenantId, senderId, reply)
              await this.messagesService.create({
                platform: 'instagram', from: senderId, content: reply, tenantId, direction: 'outgoing', status: 'sent',
              }).catch(() => {})
            }
          } catch (e) {
            console.error('Instagram AI reply error:', e)
          }
        }
      }
    }
    return { status: 'ok' }
  }
}
