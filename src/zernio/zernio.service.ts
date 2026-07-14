import { Injectable, Logger } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { lastValueFrom } from 'rxjs'
import { ConfigService } from '../config.service'
import { PrismaService } from '../prisma.service'

@Injectable()
export class ZernioService {
  private readonly logger = new Logger(ZernioService.name)
  private readonly apiBase = 'https://zernio.com/api/v1'

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  private get apiKey() {
    return this.config.get('ZERNIO_API_KEY') || ''
  }

  get isConfigured() {
    return !!this.apiKey
  }

  private headers() {
    return {
      'Authorization': 'Bearer ' + this.apiKey,
      'Content-Type': 'application/json',
    }
  }

  async createProfile(tenantId: string, name: string): Promise<any> {
    try {
      const res = await lastValueFrom(this.http.post(this.apiBase + '/profiles', {
        name: name || 'Bruskapp-' + tenantId.substring(0, 8),
        description: 'Bruskapp tenant: ' + tenantId,
      }, { headers: this.headers() }))
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
    const conn = await this.prisma.zernioConnection.findUnique({ where: { tenantId } })
    if (!conn?.profileId) {
      await this.createProfile(tenantId, 'Bruskapp-' + tenantId.substring(0, 8))
    }
    const updated = await this.prisma.zernioConnection.findUnique({ where: { tenantId } })
    if (!updated?.profileId) return null

    try {
      const res = await lastValueFrom(this.http.get(this.apiBase + '/connect/' + platform, {
        headers: this.headers(),
        params: { profileId: updated.profileId, redirectUri: 'https://bruskapp.com/api/zernio/callback' },
      }))
      return res.data?.authUrl || null
    } catch (e: any) {
      this.logger.error('Baglanti URL hatasi (' + platform + '): ' + (e?.message || 'bilinmeyen'))
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
      }, { headers: this.headers() }))

      const account = res.data?.account
      if (account?._id) {
        const platforms = (conn.platforms as any[]) || []
        const existing = platforms.findIndex((p: any) => p.platform === platform)
        const entry = { platform, accountId: account._id, status: 'connected', connectedAt: new Date().toISOString() }
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

  async handleWebhook(body: any): Promise<void> {
    const event = body?.type || body?.event
    const payload = body?.data || body
    this.logger.log('Zernio webhook alindi: ' + (event || 'bilinmeyen'))

    if (event === 'account.connected' || event === 'message.received') {
      const tenantId = payload?.profileId
        ? (await this.prisma.zernioConnection.findFirst({ where: { profileId: payload.profileId } }))?.tenantId
        : null
      if (tenantId && event === 'message.received') {
        const platform = payload?.platform || 'unknown'
        const from = payload?.from || payload?.sender?.name || 'unknown'
        const content = payload?.message || payload?.text || ''
        await this.prisma.message.create({
          data: {
            platform: 'zernio_' + platform,
            from,
            content,
            messageId: payload?.id || Date.now().toString(),
            tenantId,
            direction: 'incoming',
          },
        }).catch(e => this.logger.error('Mesaj kaydetme hatasi: ' + e.message))
      }
    }
  }
}
