import { Injectable } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { lastValueFrom } from 'rxjs'

@Injectable()
export class WhatsappService {
  private phoneNumberId: string
  private accessToken: string
  private apiVersion = 'v21.0'

  constructor(private readonly http: HttpService) {
    this.phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || ''
    this.accessToken = process.env.WHATSAPP_ACCESS_TOKEN || ''
  }

  private get baseUrl() {
    return 'https://graph.facebook.com/' + this.apiVersion + '/' + this.phoneNumberId
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    if (!this.phoneNumberId || !this.accessToken) {
      return { success: false, message: 'WhatsApp API bilgileri eksik. .env dosyasini kontrol edin.' }
    }
    try {
      const res = await lastValueFrom(
        this.http.get(this.baseUrl, {
          headers: { Authorization: 'Bearer ' + this.accessToken },
        })
      )
      return { success: true, message: 'WhatsApp baglantisi basarili: ' + (res.data?.name || 'OK') }
    } catch (e: any) {
      return { success: false, message: 'Baglanti hatasi: ' + (e?.response?.data?.error?.message || e.message) }
    }
  }

  async sendMessage(to: string, message: string): Promise<{ success: boolean; message: string }> {
    if (!this.phoneNumberId || !this.accessToken) {
      return { success: false, message: 'WhatsApp API bilgileri eksik.' }
    }
    try {
      const res = await lastValueFrom(
        this.http.post(
          this.baseUrl + '/messages',
          {
            messaging_product: 'whatsapp',
            to: to.replace(/\+/g, ''),
            type: 'text',
            text: { body: message },
          },
          { headers: { Authorization: 'Bearer ' + this.accessToken, 'Content-Type': 'application/json' } }
        )
      )
      return { success: true, message: 'Mesaj basariyla gonderildi (ID: ' + (res.data?.messages?.[0]?.id || 'OK') + ')' }
    } catch (e: any) {
      return { success: false, message: 'Gonderim hatasi: ' + (e?.response?.data?.error?.message || e.message) }
    }
  }
}
