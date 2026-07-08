import { Injectable, Logger } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { lastValueFrom } from 'rxjs'
import { PrismaService } from '../prisma.service'
import { EncryptionService } from '../common/encryption.service'

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name)
  private apiVersion = 'v21.0'

  constructor(
    private readonly http: HttpService,
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
  ) {}

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
      return { success: true, message: `Mesaj basariyla gonderildi (ID: ${res.data?.messages?.[0]?.id || 'OK'})` }
    } catch (e: any) {
      return { success: false, message: `Gonderim hatasi: ${e?.response?.data?.error?.message || e.message}` }
    }
  }

  async findByPhoneNumberId(phoneNumberId: string) {
    return this.prisma.tenantWhatsAppConfig.findFirst({ where: { phoneNumberId, active: true } })
  }

  async findByWebhookToken(token: string) {
    return this.prisma.tenantWhatsAppConfig.findFirst({ where: { webhookToken: token } })
  }
}
