import { Injectable, OnModuleInit, Logger, Optional } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { lastValueFrom } from 'rxjs'
import { ConfigService } from '../config.service'
import { MessagesService } from '../messages/messages.service'
import { PrismaService } from '../prisma.service'
import { WebchatService } from '../webchat/webchat.service'

@Injectable()
export class TelegramService implements OnModuleInit {
  private readonly logger = new Logger(TelegramService.name)
  private lastUpdateId = 0
  private pollingInterval: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
    @Optional() private readonly messagesService?: MessagesService,
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly webchatService?: WebchatService,
  ) {}

  private get botToken() {
    return this.config.get('TELEGRAM_BOT_TOKEN') || ''
  }

  private get apiBase() {
    return 'https://api.telegram.org/bot' + this.botToken
  }

  get isConfigured() {
    return !!this.botToken
  }

  async onModuleInit() {
    const paused = this.config.get('telegram_paused') === 'true'
    if (paused) { this.logger.log('Bot baslatilmadi, devre disi'); return }
    if (this.botToken) {
      await this.removeWebhook()
      this.startPolling()
    }
  }

  startPolling() {
    if (this.pollingInterval) clearInterval(this.pollingInterval)
    this.pollingInterval = setInterval(() => this.poll(), 3000)
  }

  stopPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval)
      this.pollingInterval = null
    }
  }

  private async poll() {
    if (!this.botToken) return
    try {
      const res = await lastValueFrom(this.http.get(this.apiBase + '/getUpdates', {
        params: { offset: this.lastUpdateId + 1, timeout: 10 },
      }))
      const updates = res.data?.result || []
      for (const update of updates) {
        if (update.update_id && update.update_id > this.lastUpdateId) {
          this.lastUpdateId = update.update_id
        }
        const msg = update.message
        if (msg) {
          const chatId = msg.chat?.id?.toString()
          const from = msg.from?.username || msg.from?.id?.toString() || 'unknown'
          const content = msg.text || '(media)'
          this.logger.log('Yeni mesaj: ' + from + ' -> ' + content.substring(0, 50))
          if (this.messagesService && this.prisma) {
            const tenant = await this.prisma.tenant.findFirst({ where: { slug: 'default' }, select: { id: true } })
            await this.messagesService.create({
              platform: 'telegram',
              from,
              content,
              messageId: msg.message_id?.toString() || Date.now().toString(),
              tenantId: tenant?.id || 'default',
              direction: 'incoming',
            }).catch(e => this.logger.error('Mesaj kaydetme hatasi: ' + e.message))
          }
          if (chatId && msg.text) {
            await this.autoReply(chatId, msg.text, from)
          }
        }
      }
    } catch (e: any) {
      if (e?.response?.status !== 409) {
        this.logger.error('Polling hatasi: ' + (e?.message || 'bilinmeyen'))
      }
    }
  }

  async getBotInfo(token?: string): Promise<any> {
    const tk = token || this.botToken
    if (!tk) return null
    try {
      const res = await lastValueFrom(this.http.get('https://api.telegram.org/bot' + tk + '/getMe'))
      return res.data?.result || null
    } catch { return null }
  }

  async testConnection(token?: string): Promise<{ success: boolean; message: string; botInfo?: any }> {
    const tk = token || this.botToken
    if (!tk) return { success: false, message: 'Bot token tanimlanmamis' }
    try {
      const res = await lastValueFrom(this.http.get('https://api.telegram.org/bot' + tk + '/getMe'))
      if (res.data?.ok) return { success: true, message: 'Baglanti basarili', botInfo: res.data.result }
      return { success: false, message: 'Gecersiz token: ' + (res.data?.description || 'bilinmeyen') }
    } catch (e: any) {
      if (e?.response?.data?.description) return { success: false, message: 'Gecersiz token: ' + e.response.data.description }
      return { success: false, message: 'Baglanti hatasi: ' + (e?.message || 'bilinmeyen') }
    }
  }

  async saveToken(token: string): Promise<{ success: boolean; message: string; botInfo?: any }> {
    if (!token) return { success: false, message: 'Token gerekli' }
    const test = await this.testConnection(token)
    if (!test.success) return test
    this.config.set('TELEGRAM_BOT_TOKEN', token)
    await this.removeWebhook()
    this.startPolling()
    return { success: true, message: 'Token kaydedildi ve polling baslatildi', botInfo: test.botInfo }
  }

  async removeWebhook(token?: string): Promise<void> {
    const tk = token || this.botToken
    if (!tk) return
    try {
      await lastValueFrom(this.http.post('https://api.telegram.org/bot' + tk + '/deleteWebhook', {}))
    } catch {}
  }

  async setWebhook(): Promise<{ success: boolean; message: string }> {
    return { success: false, message: 'Webhook kullanilmiyor, polling aktif' }
  }

  // --- Multi-tenant Telegram bot baglantisi ---

  private telegramTokenKey(tenantId: string) { return 'telegram_token_' + tenantId }
  private telegramInfoKey(tenantId: string) { return 'telegram_info_' + tenantId }

  async connectTenantBot(tenantId: string, token: string): Promise<{ success: boolean; message: string; botInfo?: any }> {
    if (!tenantId || !token) return { success: false, message: 'tenantId ve token gerekli' }
    const test = await this.testConnection(token)
    if (!test.success) return test
    await this.removeWebhook(token)
    const webhookUrl = 'https://bruskapp.com/api/telegram/webhook/' + tenantId
    try {
      const res = await lastValueFrom(this.http.post('https://api.telegram.org/bot' + token + '/setWebhook', {
        url: webhookUrl,
        allowed_updates: ['message', 'callback_query'],
      }))
      if (!res.data?.ok) {
        return { success: false, message: 'Webhook ayarlanamadi: ' + (res.data?.description || '') }
      }
    } catch (e: any) {
      return { success: false, message: 'Webhook hatasi: ' + (e?.message || '') }
    }
    this.config.set(this.telegramTokenKey(tenantId), token)
    if (test.botInfo) {
      this.config.set(this.telegramInfoKey(tenantId), JSON.stringify(test.botInfo))
    }
    this.logger.log('Tenant bot baglandi: ' + tenantId + ' -> @' + (test.botInfo?.username || ''))
    return { success: true, message: 'Bot basariyla baglandi', botInfo: test.botInfo }
  }

  async disconnectTenantBot(tenantId: string): Promise<{ success: boolean; message: string }> {
    const token = this.getTenantBotToken(tenantId)
    if (!token) return { success: false, message: 'Bagli bot bulunamadi' }
    await this.removeWebhook(token)
    this.config.set(this.telegramTokenKey(tenantId), '')
    this.config.set(this.telegramInfoKey(tenantId), '')
    return { success: true, message: 'Bot baglantisi kesildi' }
  }

  getTenantBotToken(tenantId: string): string {
    return this.config.get(this.telegramTokenKey(tenantId)) || ''
  }

  getTenantBotInfo(tenantId: string): any {
    const raw = this.config.get(this.telegramInfoKey(tenantId))
    if (!raw) return null
    try { return JSON.parse(raw) } catch { return null }
  }

  async handleTenantWebhook(tenantId: string, body: any): Promise<boolean> {
    const token = this.getTenantBotToken(tenantId)
    if (!token) return false
    const msg = body?.message
    if (!msg) return true
    const chatId = msg.chat?.id?.toString()
    const from = msg.from?.username || msg.from?.id?.toString() || 'unknown'
    const content = msg.text || '(media)'
    const fromName = msg.from?.first_name || ''
    this.logger.log('Tenant [' + tenantId + '] mesaj: ' + from + ' -> ' + content.substring(0, 50))

    if (this.messagesService) {
      await this.messagesService.create({
        platform: 'telegram',
        from,
        fromName,
        content,
        messageId: msg.message_id?.toString() || Date.now().toString(),
        tenantId,
        direction: 'incoming',
      }).catch(e => this.logger.error('Mesaj kaydetme hatasi: ' + e.message))
    }

    if (chatId && msg.text) {
      let reply = ''
      const dsActive = !!this.config.get('DEEPSEEK_API_KEY')
      if (dsActive) {
        let systemPrompt = 'Sen yardimsever bir yapay zeka asistanisin. Kisa ve dogal cevaplar ver. Turkce konus.'
        if (this.webchatService) {
          const wc = this.webchatService.getConfig()
          const parts: string[] = []
          if (wc.businessName) parts.push('Isletme Adi: ' + wc.businessName)
          if (wc.description) parts.push('Aciklama: ' + wc.description)
          if (wc.address) parts.push('Adres: ' + wc.address)
          if (wc.phone) parts.push('Telefon: ' + wc.phone)
          if (wc.email) parts.push('E-posta: ' + wc.email)
          if (wc.hours) parts.push('Calisma Saatleri: ' + wc.hours)
          if (wc.knowledgeBase) parts.push('BILGI HAVUZU:\n' + wc.knowledgeBase)
          if (wc.systemPrompt) parts.push(wc.systemPrompt)
          if (parts.length > 0) {
            systemPrompt = 'Sen bir isletmenin yapay zeka asistanisin. Su bilgileri kullanarak kisa, dogal ve yardimsever cevaplar ver:\n\n' + parts.join('\n') + '\n\nSadece sana verilen bilgileri kullan. Bilmiyorsan uydurma, yonlendir.'
          }
        }
        try {
          const apiKey = this.config.get('DEEPSEEK_API_KEY')
          const res = await lastValueFrom(this.http.post('https://api.deepseek.com/v1/chat/completions', {
            model: 'deepseek-chat',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: msg.text },
            ],
            temperature: 0.3,
            max_tokens: 500,
          }, {
            headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
            timeout: 15000,
          }))
          const choice = res.data?.choices?.[0]
          reply = choice?.message?.content || ''
        } catch (e: any) {
          this.logger.error('DeepSeek hatasi (tenant webhook): ' + (e?.message || ''))
        }
      }
      if (!reply) {
        reply = this.config.get('TELEGRAM_AUTO_REPLY') || 'Mesajiniz alindi. En kisa surede donus yapilacaktir.'
      }
      try {
        await lastValueFrom(this.http.post('https://api.telegram.org/bot' + token + '/sendMessage', {
          chat_id: chatId, text: reply, parse_mode: 'HTML',
        }))
        if (this.messagesService) {
          await this.messagesService.create({
            platform: 'telegram',
            from: from,
            fromName: fromName,
            content: reply,
            messageId: 'out_' + Date.now().toString(),
            tenantId,
            direction: 'outgoing',
          }).catch(() => {})
        }
      } catch (e: any) {
        this.logger.error('Oto-yanit hatasi: ' + (e?.message || ''))
      }
    }
    return true
  }

  async getTenantBotStatus(tenantId: string): Promise<{ connected: boolean; botInfo: any }> {
    const token = this.getTenantBotToken(tenantId)
    if (!token) return { connected: false, botInfo: null }
    const info = this.getTenantBotInfo(tenantId)
    if (info) return { connected: true, botInfo: info }
    const fresh = await this.getBotInfo(token)
    if (fresh) {
      this.config.set(this.telegramInfoKey(tenantId), JSON.stringify(fresh))
      return { connected: true, botInfo: fresh }
    }
    return { connected: false, botInfo: null }
  }

  async sendMessage(chatId: string, text: string, parseMode = 'HTML'): Promise<boolean> {
    if (!this.botToken || !chatId || !text) return false
    try {
      const res = await lastValueFrom(this.http.post(this.apiBase + '/sendMessage', {
        chat_id: chatId, text, parse_mode: parseMode,
      }))
      return !!res.data?.ok
    } catch { return false }
  }

  async sendTenantMessage(tenantId: string, chatId: string, text: string, parseMode = 'HTML'): Promise<boolean> {
    const token = this.getTenantBotToken(tenantId)
    if (!token || !chatId || !text) return false
    try {
      const res = await lastValueFrom(this.http.post('https://api.telegram.org/bot' + token + '/sendMessage', {
        chat_id: chatId, text, parse_mode: parseMode,
      }))
      return !!res.data?.ok
    } catch { return false }
  }

  async sendNotification(title: string, message: string): Promise<boolean> {
    const chatId = this.config.get('TELEGRAM_NOTIFICATION_CHAT_ID')
    if (!this.botToken || !chatId) return false
    const text = '🔔 <b>' + this.escapeHtml(title) + '</b>\n\n' + this.escapeHtml(message)
    return this.sendMessage(chatId, text)
  }

  private escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }

  private async chatWithDeepSeek(userMsg: string): Promise<string> {
    const apiKey = this.config.get('DEEPSEEK_API_KEY')
    if (!apiKey) return ''
    const paused = this.config.get('deepseek_paused') === 'true'
    if (paused) return ''
    try {
      const res = await lastValueFrom(this.http.post('https://api.deepseek.com/v1/chat/completions', {
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: 'Sen bruskapp.com\'un yapay zeka asistanisin. Kisa, dogal ve yardimsever cevaplar ver. Turkce konus.' },
          { role: 'user', content: userMsg },
        ],
        temperature: 0.7,
        max_tokens: 500,
      }, {
        headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      }))
      const choice = res.data?.choices?.[0]
      return choice?.message?.content || ''
    } catch (e: any) {
      this.logger.error('DeepSeek hatasi: ' + (e?.message || 'bilinmeyen'))
      return ''
    }
  }

  async autoReply(chatId: string, incomingText: string, from?: string): Promise<void> {
    let reply = ''
    const dsActive = !!this.config.get('DEEPSEEK_API_KEY') && this.config.get('deepseek_paused') !== 'true'
    if (dsActive) {
      reply = await this.chatWithDeepSeek(incomingText)
    }
    if (!reply) {
      reply = this.config.get('TELEGRAM_AUTO_REPLY') || 'Mesajiniz alindi. En kisa surede donus yapilacaktir.'
    }
    await this.sendMessage(chatId, reply)
    if (this.messagesService && this.prisma && from) {
      const tenant = await this.prisma.tenant.findFirst({ where: { slug: 'default' }, select: { id: true } })
      await this.messagesService.create({
        platform: 'telegram',
        from: from,
        content: reply,
        messageId: 'out_' + Date.now().toString(),
        tenantId: tenant?.id || 'default',
        direction: 'outgoing',
      }).catch(() => {})
    }
  }

  async getPollingStatus() {
    const paused = this.config.get('telegram_paused') === 'true'
    return {
      configured: this.isConfigured,
      polling: this.pollingInterval !== null,
      paused,
      active: this.isConfigured && !paused,
    }
  }

  async togglePolling() {
    if (!this.isConfigured) return { success: false, message: 'Bot yapilandirilmamis' }
    const paused = this.config.get('telegram_paused') === 'true'
    if (paused) {
      this.config.set('telegram_paused', 'false')
      this.startPolling()
      return { success: true, message: 'Bot aktif edildi', active: true }
    } else {
      this.config.set('telegram_paused', 'true')
      this.stopPolling()
      return { success: true, message: 'Bot durduruldu', active: false }
    }
  }

  async getDeepSeekStatus() {
    const paused = this.config.get('deepseek_paused') === 'true'
    const hasKey = !!this.config.get('DEEPSEEK_API_KEY')
    return {
      configured: hasKey,
      paused,
      active: hasKey && !paused,
    }
  }

  async toggleDeepSeek() {
    const hasKey = !!this.config.get('DEEPSEEK_API_KEY')
    if (!hasKey) return { success: false, message: 'DeepSeek API anahtari tanimlanmamis' }
    const paused = this.config.get('deepseek_paused') === 'true'
    if (paused) {
      this.config.set('deepseek_paused', 'false')
      return { success: true, message: 'DeepSeek AI aktif edildi', active: true }
    } else {
      this.config.set('deepseek_paused', 'true')
      return { success: true, message: 'DeepSeek AI durduruldu, token tuketimi yok', active: false }
    }
  }
}
