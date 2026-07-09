import { Injectable, Logger } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { lastValueFrom } from 'rxjs'
import * as fs from 'fs'
import * as path from 'path'
import { PrismaService } from '../prisma.service'
import { EncryptionService } from '../common/encryption.service'

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name)
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

  async getConfig(tenantId: string) {
    const config = await this.prisma.tenantWhatsAppConfig.findUnique({ where: { tenantId } })
    if (!config) return null
    return {
      ...config,
      accessToken: this.encryption.decrypt(config.accessToken),
    }
  }

  async saveConfig(tenantId: string, data: { accessToken: string; phoneNumberId: string; webhookToken: string; active?: boolean }) {
    const encrypted = {
      ...data,
      phoneNumberId: data.phoneNumberId.trim(),
      accessToken: this.encryption.encrypt(data.accessToken),
      webhookToken: data.webhookToken.trim(),
    }
    return this.prisma.tenantWhatsAppConfig.upsert({
      where: { tenantId },
      create: { tenantId, ...encrypted },
      update: encrypted,
    })
  }

  private async getCredentials(tenantId: string) {
    const config = await this.getConfig(tenantId)
    if (!config) throw new Error('WhatsApp yapilandirmasi bulunamadi')
    return { accessToken: config.accessToken, phoneNumberId: config.phoneNumberId }
  }

  async testConnection(tenantId: string) {
    try {
      const { accessToken, phoneNumberId } = await this.getCredentials(tenantId)
      const res = await lastValueFrom(
        this.http.get(`https://graph.facebook.com/${this.apiVersion}/${phoneNumberId}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        })
      )
      return { success: true, message: `WhatsApp baglantisi basarili: ${res.data?.name || 'OK'}` }
    } catch (e: any) {
      return { success: false, message: `Baglanti hatasi: ${e?.response?.data?.error?.message || e.message}` }
    }
  }

  async sendMessage(tenantId: string, to: string, message: string) {
    try {
      const { accessToken, phoneNumberId } = await this.getCredentials(tenantId)
      const res = await lastValueFrom(
        this.http.post(
          `https://graph.facebook.com/${this.apiVersion}/${phoneNumberId}/messages`,
          {
            messaging_product: 'whatsapp',
            to: to.replace(/[^0-9]/g, ''),
            type: 'text',
            text: { body: message },
          },
          { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
        )
      )
      const msgId = res.data?.messages?.[0]?.id
      return { success: true, messageId: msgId, message: `Mesaj basariyla gonderildi${msgId ? ' (ID: ' + msgId + ')' : ''}` }
    } catch (e: any) {
      return { success: false, message: `Gonderim hatasi: ${e?.response?.data?.error?.message || e.message}` }
    }
  }

  async markAsRead(tenantId: string, to: string, messageId: string) {
    try {
      const { accessToken, phoneNumberId } = await this.getCredentials(tenantId)
      await lastValueFrom(
        this.http.post(
          `https://graph.facebook.com/${this.apiVersion}/${phoneNumberId}/messages`,
          {
            messaging_product: 'whatsapp',
            status: 'read',
            message_id: messageId,
          },
          { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
        )
      )
    } catch {}
  }

  async sendTypingIndicator(tenantId: string, to: string, typing: boolean) {
    try {
      const { accessToken, phoneNumberId } = await this.getCredentials(tenantId)
      const res = await lastValueFrom(
        this.http.post(
          `https://graph.facebook.com/${this.apiVersion}/${phoneNumberId}/messages`,
          {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: to.replace(/[^0-9]/g, ''),
            type: 'action',
            action: { name: typing ? 'typing_on' : 'typing_off' },
          },
          { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
        )
      )
      this.logger.log(`Typing ${typing ? 'on' : 'off'} for ${to}: ${JSON.stringify(res.data)}`)
    } catch (e: any) {
      this.logger.error(`Typing ${typing ? 'on' : 'off'} error for ${to}: ${e?.response?.data?.error?.message || e.message}`)
    }
  }

  async findByPhoneNumberId(phoneNumberId: string) {
    return this.prisma.tenantWhatsAppConfig.findFirst({ where: { phoneNumberId, active: true } })
  }

  async findByWebhookToken(token: string) {
    return this.prisma.tenantWhatsAppConfig.findFirst({ where: { webhookToken: token } })
  }

  async getProfile(tenantId: string) {
    try {
      const { accessToken, phoneNumberId } = await this.getCredentials(tenantId)
      const res = await lastValueFrom(
        this.http.get(
          `https://graph.facebook.com/${this.apiVersion}/${phoneNumberId}/whatsapp_business_profile?fields=about,description,email,websites,profile_picture_url,address`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        )
      )
      return { success: true, data: res.data?.data?.[0] || res.data }
    } catch (e: any) {
      return { success: false, message: `Profil hatasi: ${e?.response?.data?.error?.message || e.message}` }
    }
  }

  async updateProfile(tenantId: string, profile: { about?: string; description?: string; email?: string; websites?: string[] }) {
    try {
      const { accessToken, phoneNumberId } = await this.getCredentials(tenantId)
      const body: any = { messaging_product: 'whatsapp' }
      if (profile.about !== undefined && profile.about !== '') body.about = profile.about
      if (profile.description !== undefined && profile.description !== '') body.description = profile.description
      if (profile.email !== undefined && profile.email !== '') body.email = profile.email
      if (profile.websites !== undefined && profile.websites.length > 0) body.websites = profile.websites
      if (Object.keys(body).length <= 1) return { success: true, message: 'Guncellenecek alan yok' }
      const res = await lastValueFrom(
        this.http.post(
          `https://graph.facebook.com/${this.apiVersion}/${phoneNumberId}/whatsapp_business_profile`,
          body,
          { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
        )
      )
      this.logger.log(`WhatsApp profile update response: ${JSON.stringify(res.data)}`)
      return { success: true, message: 'Profil guncellendi', apiResponse: res.data }
    } catch (e: any) {
      this.logger.error(`WhatsApp profile update error: ${JSON.stringify(e?.response?.data) || e.message}`)
      return { success: false, message: `Guncelleme hatasi: ${e?.response?.data?.error?.message || e.message}`, apiError: e?.response?.data }
    }
  }

  async uploadProfilePicture(tenantId: string, filePath: string, mimeType: string) {
    // WhatsApp Cloud API profil resmini API uzerinden degistirmeyi desteklemez.
    // Sadece Meta panelinden degistirilebilir: https://business.facebook.com/wa/manage
    fs.unlink(filePath, () => {})
    return { success: false, message: 'WhatsApp Cloud API profil resmi yuklemeyi desteklemiyor. Lutfen Meta panelinden guncelleyin: https://business.facebook.com/wa/manage' }
  }
}
