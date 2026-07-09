import { Injectable, Logger } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { lastValueFrom } from 'rxjs'
import { PrismaService } from '../prisma.service'
import { EncryptionService } from '../common/encryption.service'

@Injectable()
export class InstagramService {
  private readonly logger = new Logger(InstagramService.name)
  private apiVersion = 'v21.0'
  private pausedConversations = new Set<string>()

  constructor(
    private readonly http: HttpService,
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  isAiPaused(tenantId: string, from: string): boolean {
    return this.pausedConversations.has(tenantId + ':' + from)
  }

  setAiPaused(tenantId: string, from: string, paused: boolean) {
    const key = tenantId + ':' + from
    if (paused) this.pausedConversations.add(key)
    else this.pausedConversations.delete(key)
  }

  async getUsername(tenantId: string, senderId: string): Promise<string | null> {
    try {
      const { accessToken } = await this.getCredentials(tenantId)
      const res = await lastValueFrom(
        this.http.get(`https://graph.facebook.com/${this.apiVersion}/${senderId}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: { fields: 'username,name' },
        })
      )
      return res.data?.username || res.data?.name || null
    } catch {
      return null
    }
  }

  async getConfig(tenantId: string) {
    const config = await this.prisma.tenantInstagramConfig.findUnique({ where: { tenantId } })
    if (!config) return null
    return {
      ...config,
      accessToken: this.encryption.decrypt(config.accessToken),
    }
  }

  async saveConfig(tenantId: string, data: { accessToken: string; igBusinessAccountId: string; webhookToken: string; active?: boolean }) {
    const encrypted = {
      ...data,
      igBusinessAccountId: data.igBusinessAccountId.trim(),
      accessToken: this.encryption.encrypt(data.accessToken),
      webhookToken: data.webhookToken.trim(),
    }
    return this.prisma.tenantInstagramConfig.upsert({
      where: { tenantId },
      create: { tenantId, ...encrypted },
      update: encrypted,
    })
  }

  private async getCredentials(tenantId: string) {
    const config = await this.getConfig(tenantId)
    if (!config) throw new Error('Instagram yapilandirmasi bulunamadi')
    return { accessToken: config.accessToken, igBusinessAccountId: config.igBusinessAccountId }
  }

  async testConnection(tenantId: string) {
    try {
      const { accessToken, igBusinessAccountId } = await this.getCredentials(tenantId)
      const res = await lastValueFrom(
        this.http.get(`https://graph.facebook.com/${this.apiVersion}/${igBusinessAccountId}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: { fields: 'name,username' },
        })
      )
      return { success: true, message: `Baglanti basarili: @${res.data?.username || res.data?.name || 'OK'}` }
    } catch (e: any) {
      return { success: false, message: `Baglanti hatasi: ${e?.response?.data?.error?.message || e.message}` }
    }
  }

  async sendMessage(tenantId: string, to: string, text: string) {
    try {
      const { accessToken, igBusinessAccountId } = await this.getCredentials(tenantId)
      const res = await lastValueFrom(
        this.http.post(
          `https://graph.facebook.com/${this.apiVersion}/${igBusinessAccountId}/messages`,
          { recipient: { id: to }, message: { text } },
          { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
        )
      )
      return { success: true, message: `Mesaj gonderildi (ID: ${res.data?.message_id || 'OK'})` }
    } catch (e: any) {
      return { success: false, message: `Gonderim hatasi: ${e?.response?.data?.error?.message || e.message}` }
    }
  }

  async findByIgBusinessAccountId(igBusinessAccountId: string) {
    return this.prisma.tenantInstagramConfig.findFirst({ where: { igBusinessAccountId, active: true } })
  }

  async findByWebhookToken(token: string) {
    return this.prisma.tenantInstagramConfig.findFirst({ where: { webhookToken: token } })
  }
}
