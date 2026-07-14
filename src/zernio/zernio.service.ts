import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { lastValueFrom } from 'rxjs'
import * as crypto from 'crypto'
import { ConfigService } from '../config.service'
import { PrismaService } from '../prisma.service'

@Injectable()
export class ZernioService implements OnModuleInit {
  private readonly logger = new Logger(ZernioService.name)
  private readonly apiBase = 'https://zernio.com/api/v1'
  private readonly webhookUrl = 'https://bruskapp.com/api/zernio/webhook'

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  private get apiKey() { return this.config.get('ZERNIO_API_KEY') || '' }

  get isConfigured() { return !!this.apiKey }

  private headers() {
    return {
      'Authorization': 'Bearer ' + this.apiKey,
      'Content-Type': 'application/json',
    }
  }

  async onModuleInit() {
    if (this.apiKey) {
      await this.ensureWebhook()
    }
  }

  async ensureWebhook() {
    try {
      const res = await lastValueFrom(this.http.get(this.apiBase + '/webhooks/settings', { headers: this.headers() }))
      const webhooks: any[] = res.data?.webhooks || []
      const existing = webhooks.find(w => w.url === this.webhookUrl)
      if (existing) {
        this.logger.log('Webhook zaten kayitli: ' + existing._id)
        return
      }
      await this.registerWebhook()
    } catch (e: any) {
      this.logger.warn('Webhook kontrolu basarisiz, yeni olusturuluyor: ' + (e?.message || ''))
      await this.registerWebhook()
    }
  }

  private async registerWebhook() {
    const secret = crypto.randomBytes(24).toString('hex')
    try {
      const res = await lastValueFrom(this.http.post(this.apiBase + '/webhooks/settings', {
        name: 'Bruskapp',
        url: this.webhookUrl,
        secret,
        events: ['message.received', 'account.connected', 'account.disconnected'],
        isActive: true,
      }, { headers: this.headers() }))
      const webhook = res.data?.webhook
      if (webhook?._id) {
        this.config.set('ZERNIO_WEBHOOK_SECRET', secret)
        this.logger.log('Webhook olusturuldu: ' + webhook._id)
      }
    } catch (e: any) {
      this.logger.error('Webhook olusturma hatasi: ' + (e?.message || ''))
    }
  }

  async createProfile(tenantId: string, name: string): Promise<any> {
    try {
      const res = await lastValueFrom(this.http.post(this.apiBase + '/profiles', {
        name: name || 'Bruskapp-' + tenantId.substring(0, 8),
        description: 'Bruskapp tenant: ' + tenantId,
      }, { headers: this.headers(), timeout: 15000 }))
      const profile = res.data?.profile
      if (profile?._id) {
        await this.prisma.zernioConnection.upsert({
          where: { tenantId },
          update: { profileId: profile._id },
          create: { tenantId, profileId: profile._id, platforms: [] },
        })
      }
      return profile
    } catch (e: any) {
      this.logger.error('Profile olusturma hatasi: ' + (e?.message || 'bilinmeyen'))
      throw e
    }
  }

  async getConnectUrl(tenantId: string, platform: string): Promise<string | null> {
    let conn = await this.prisma.zernioConnection.findUnique({ where: { tenantId } })
    if (!conn?.profileId) {
      const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } })
      const name = tenant?.name || 'Bruskapp-' + tenantId.substring(0, 8)
      await this.createProfile(tenantId, name)
    }
    const updated = await this.prisma.zernioConnection.findUnique({ where: { tenantId } })
    if (!updated?.profileId) return null

    try {
      const res = await lastValueFrom(this.http.get(this.apiBase + '/connect/' + platform, {
        headers: this.headers(),
        params: {
          profileId: updated.profileId,
          headless: 'true',
          redirect_url: 'https://bruskapp.com/api/zernio/callback',
        },
        timeout: 30000,
      }))
      const authUrl = res.data?.authUrl || null
      if (!authUrl) {
        this.logger.warn('Zernio authUrl bos (platform=' + platform + '): ' + JSON.stringify(res.data))
      }
      return authUrl
    } catch (e: any) {
      const errBody = e?.response?.data ? JSON.stringify(e.response.data) : ''
      this.logger.error('Baglanti URL hatasi (' + platform + '): ' + (e?.message || 'bilinmeyen') + ' ' + errBody)
      return null
    }
  }

  async handleCallback(tenantId: string, platform: string, code: string): Promise<boolean> {
    try {
      const conn = await this.prisma.zernioConnection.findUnique({ where: { tenantId } })
      if (!conn?.profileId) return false

      const res = await lastValueFrom(this.http.post(this.apiBase + '/connect/' + platform + '/callback', {
        profileId: conn.profileId,
        code,
      }, { headers: this.headers(), timeout: 15000 }))

      const account = res.data?.account
      if (account?._id) {
        const platforms = (conn.platforms as any[]) || []
        const existing = platforms.findIndex((p: any) => p.platform === platform)
        const entry = { platform, accountId: account._id, status: 'connected', connectedAt: new Date().toISOString(), username: account.username || '' }
        if (existing >= 0) platforms[existing] = entry
        else platforms.push(entry)

        await this.prisma.zernioConnection.update({
          where: { tenantId },
          data: { platforms },
        })
        return true
      }
      return false
    } catch (e: any) {
      this.logger.error('Callback hatasi (' + platform + '): ' + (e?.message || 'bilinmeyen'))
      return false
    }
  }

  async handleHeadlessCallback(params: { profileId?: string; tempToken?: string; platform?: string; step?: string; connect_token?: string; userProfile?: string; error?: string; message?: string }): Promise<{ success: boolean; platform?: string; redirectUrl?: string }> {
    if (params.error) {
      this.logger.warn('OAuth iptal/hatali: ' + (params.error || 'bilinmeyen'))
      return { success: false }
    }

    const conn = await this.prisma.zernioConnection.findFirst({ where: { profileId: params.profileId } })
    if (!conn) return { success: false }

    const platform = params.platform || ''
    if (params.step === 'select_page' || params.step === 'connect_account') {
      try {
        const pagesRes = await lastValueFrom(this.http.get(this.apiBase + '/connect/facebook/select-page', {
          headers: this.headers(),
          params: { profileId: params.profileId, tempToken: params.tempToken },
        }))
        const pages = pagesRes.data?.pages || pagesRes.data?.phoneNumbers || []
        if (pages.length === 0) return { success: false }

        const userProfile = params.userProfile ? JSON.parse(decodeURIComponent(params.userProfile)) : {}
        const selectRes = await lastValueFrom(this.http.post(this.apiBase + '/connect/facebook/select-page', {
          profileId: params.profileId,
          pageId: pages[0].id,
          tempToken: params.tempToken,
          userProfile,
          redirect_url: 'https://bruskapp.com/api/zernio/callback',
        }, { headers: this.headers() }))

        const account = selectRes.data?.account
        if (account?._id) {
          const platforms = (conn.platforms as any[]) || []
          const existing = platforms.findIndex((p: any) => p.platform === platform)
          const entry = { platform, accountId: account._id, status: 'connected', connectedAt: new Date().toISOString(), username: account.username || '' }
          if (existing >= 0) platforms[existing] = entry
          else platforms.push(entry)

          await this.prisma.zernioConnection.update({
            where: { tenantId: conn.tenantId },
            data: { platforms },
          })
          return { success: true, platform, redirectUrl: selectRes.data?.redirect_url }
        }
      } catch (e: any) {
        this.logger.error('Headless sayfa/secim hatasi: ' + (e?.message || ''))
        return { success: false }
      }
    } else if (params.tempToken) {
      try {
        const res = await lastValueFrom(this.http.post(this.apiBase + '/connect/' + platform + '/callback', {
          profileId: params.profileId,
          tempToken: params.tempToken,
        }, { headers: this.headers() }))

        const account = res.data?.account
        if (account?._id) {
          const platforms = (conn.platforms as any[]) || []
          const existing = platforms.findIndex((p: any) => p.platform === platform)
          const entry = { platform, accountId: account._id, status: 'connected', connectedAt: new Date().toISOString(), username: account.username || '' }
          if (existing >= 0) platforms[existing] = entry
          else platforms.push(entry)

          await this.prisma.zernioConnection.update({
            where: { tenantId: conn.tenantId },
            data: { platforms },
          })
          return { success: true, platform, redirectUrl: res.data?.redirect_url }
        }
      } catch (e: any) {
        this.logger.error('Headless callback hatasi: ' + (e?.message || ''))
        return { success: false }
      }
    }

    return { success: false }
  }

  async getConnections(tenantId?: string): Promise<any[]> {
    if (tenantId) {
      const conn = await this.prisma.zernioConnection.findUnique({ where: { tenantId } })
      return conn ? [{ tenantId, profileId: conn.profileId, platforms: conn.platforms }] : []
    }
    const all = await this.prisma.zernioConnection.findMany({
      include: { tenant: { select: { id: true, name: true, slug: true } } },
    })
    return all.map(c => ({
      tenantId: c.tenantId,
      tenantName: c.tenant?.name || c.tenant?.slug || 'Bilinmiyor',
      profileId: c.profileId,
      platforms: c.platforms,
    }))
  }

  async disconnectPlatform(tenantId: string, platform: string): Promise<boolean> {
    const conn = await this.prisma.zernioConnection.findUnique({ where: { tenantId } })
    if (!conn) return false
    const platforms = (conn.platforms as any[]).filter((p: any) => p.platform !== platform)
    await this.prisma.zernioConnection.update({
      where: { tenantId },
      data: { platforms },
    })
    return true
  }

  verifySignature(rawBody: string, signature: string): boolean {
    const secret = this.config.get('ZERNIO_WEBHOOK_SECRET')
    if (!secret || !signature) return false
    const computed = crypto.createHmac('sha256', Buffer.from(secret)).update(rawBody).digest('hex')
    return computed === signature
  }

  async handleWebhook(body: any, rawBody?: string, signature?: string): Promise<boolean> {
    if (signature && !this.verifySignature(rawBody || '', signature)) {
      this.logger.warn('Webhook imza dogrulamasi BASARISIZ')
      return false
    }

    const event = body?.type || body?.event
    const payload = body?.data || body?.message || body
    this.logger.log('Zernio webhook alindi: ' + (event || 'bilinmeyen'))

    if (event === 'message.received') {
      const profileId = payload?.account?.profileId || payload?.profileId
      if (profileId) {
        const conn = await this.prisma.zernioConnection.findFirst({ where: { profileId } })
        if (conn?.tenantId) {
          const platform = payload?.account?.platform || 'unknown'
          const from = payload?.message?.from || payload?.message?.sender?.name || payload?.from || 'unknown'
          const content = payload?.message?.text || payload?.message?.content || payload?.text || ''
          const messageId = body?.id || payload?.message?._id || Date.now().toString()

          await this.prisma.message.create({
            data: {
              platform: 'zernio_' + platform,
              from,
              content,
              messageId,
              tenantId: conn.tenantId,
              direction: 'incoming',
            },
          }).catch(e => this.logger.error('Mesaj kaydetme hatasi: ' + e.message))
        }
      }
    }

    if (event === 'account.connected') {
      const profileId = payload?.account?.profileId || payload?.profileId
      if (profileId) {
        const account = payload?.account
        const conn = await this.prisma.zernioConnection.findFirst({ where: { profileId } })
        if (conn && account) {
          const platforms = (conn.platforms as any[]) || []
          const existing = platforms.findIndex((p: any) => p.platform === account.platform)
          const entry = { platform: account.platform, accountId: account.accountId || account._id, status: 'connected', connectedAt: new Date().toISOString(), username: account.username || '' }
          if (existing >= 0) platforms[existing] = entry
          else platforms.push(entry)

          await this.prisma.zernioConnection.update({
            where: { tenantId: conn.tenantId },
            data: { platforms },
          })
        }
      }
    }

    if (event === 'account.disconnected') {
      const profileId = payload?.account?.profileId || payload?.profileId
      if (profileId) {
        const account = payload?.account
        const conn = await this.prisma.zernioConnection.findFirst({ where: { profileId } })
        if (conn && account) {
          const platforms = (conn.platforms as any[]).filter((p: any) => p.platform !== account.platform)
          await this.prisma.zernioConnection.update({
            where: { tenantId: conn.tenantId },
            data: { platforms },
          })
        }
      }
    }

    return true
  }
}
