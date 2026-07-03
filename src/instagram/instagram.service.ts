import { Injectable, Logger } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { lastValueFrom } from 'rxjs'
import { ConfigService } from '../config.service'

@Injectable()
export class InstagramService {
  private readonly logger = new Logger(InstagramService.name)

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  private get igUserId() { return this.config.get('INSTAGRAM_USER_ID') || '' }
  private get accessToken() { return this.config.get('INSTAGRAM_ACCESS_TOKEN') || '' }
  private get apiVersion() { return 'v21.0' }
  private get isConfigured() { return !!this.igUserId && !!this.accessToken }

  async testConnection(token?: string, userId?: string): Promise<{ success: boolean; message: string }> {
    const tk = token || this.accessToken
    const uid = userId || this.igUserId
    if (!tk || !uid) return { success: false, message: 'Instagram API bilgileri eksik' }
    try {
      const res = await lastValueFrom(
        this.http.get('https://graph.facebook.com/' + this.apiVersion + '/' + uid, {
          headers: { Authorization: 'Bearer ' + tk },
          params: { fields: 'name,username' }
        })
      )
      return { success: true, message: 'Baglanti basarili: @' + (res.data?.username || res.data?.name || 'OK') }
    } catch (e: any) {
      return { success: false, message: 'Baglanti hatasi: ' + (e?.response?.data?.error?.message || e.message) }
    }
  }

  async saveConfig(userId: string, token: string): Promise<{ success: boolean; message: string }> {
    if (!userId || !token) return { success: false, message: 'Kullanici ID ve token gerekli' }
    const test = await this.testConnection(token, userId)
    if (!test.success) return test
    this.config.set('INSTAGRAM_USER_ID', userId)
    this.config.set('INSTAGRAM_ACCESS_TOKEN', token)
    return { success: true, message: 'Instagram bilgileri kaydedildi' }
  }

  async sendMessage(to: string, text: string): Promise<{ success: boolean; message: string }> {
    if (!this.isConfigured) return { success: false, message: 'Instagram API bilgileri eksik' }
    try {
      const res = await lastValueFrom(
        this.http.post(
          'https://graph.facebook.com/' + this.apiVersion + '/' + this.igUserId + '/messages',
          { recipient: { id: to }, message: { text } },
          { headers: { Authorization: 'Bearer ' + this.accessToken, 'Content-Type': 'application/json' } }
        )
      )
      return { success: true, message: 'Mesaj gonderildi (ID: ' + (res.data?.message_id || 'OK') + ')' }
    } catch (e: any) {
      return { success: false, message: 'Gonderim hatasi: ' + (e?.response?.data?.error?.message || e.message) }
    }
  }
}
