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
    // Ana bot polling
    const paused = this.config.get('telegram_paused') === 'true'
    if (!paused && this.botToken) {
      await this.removeWebhook()
      this.startPolling()
    }

    // Multi-tenant bot webhooklarini yeniden kur
    await this.reconnectAllTenantBots()
  }

  private async reconnectAllTenantBots() {
    try {
      if (!this.prisma) return
      const configs = await this.prisma.telegramConfig.findMany({ where: { active: true } })
      for (const tc of configs) {
        try {
          const test = await this.testConnection(tc.botToken)
          if (test.success) {
            await this.removeWebhook(tc.botToken)
            const webhookUrl = 'https://bruskapp.com/api/telegram/webhook/' + tc.tenantId
            const res = await lastValueFrom(this.http.post('https://api.telegram.org/bot' + tc.botToken + '/setWebhook', {
              url: webhookUrl,
              allowed_updates: ['message', 'callback_query'],
            }))
            if (res.data?.ok) {
              this.logger.log('Tenant bot webhook yeniden kuruldu: ' + tc.tenantId)
              // ConfigService'e de yaz ki handleTenantWebhook bulabilsin
              this.config.set(this.telegramTokenKey(tc.tenantId), tc.botToken)
              if (tc.botInfo) {
                this.config.set(this.telegramInfoKey(tc.tenantId), JSON.stringify(tc.botInfo))
              }
            }
          } else {
            this.logger.warn('Tenant bot token gecersiz, devre disi: ' + tc.tenantId)
            await this.prisma.telegramConfig.update({
              where: { tenantId: tc.tenantId },
              data: { active: false },
            })
          }
        } catch (e: any) {
          this.logger.error('Tenant bot yeniden baglama hatasi (' + tc.tenantId + '): ' + (e?.message || ''))
        }
      }
      this.logger.log('Multi-tenant bot yeniden baglama tamam: ' + configs.length + ' bot')
    } catch (e: any) {
      this.logger.error('Multi-tenant bot yeniden baglama hatasi: ' + (e?.message || ''))
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
    // DB'ye de kaydet (kalici depolama)
    if (this.prisma) {
      await this.prisma.telegramConfig.upsert({
        where: { tenantId },
        update: { botToken: token, botInfo: test.botInfo || undefined, active: true },
        create: { tenantId, botToken: token, botInfo: test.botInfo || undefined, active: true },
      }).catch(e => this.logger.error('TelegramConfig kaydetme hatasi: ' + e.message))
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
    if (this.prisma) {
      await this.prisma.telegramConfig.update({
        where: { tenantId },
        data: { active: false },
      }).catch(() => {})
    }
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

  getTenantChatId(tenantId: string): string {
    return this.config.get(this.telegramChatIdKey(tenantId)) || ''
  }

  private telegramChatIdKey(tenantId: string) { return 'telegram_chat_id_' + tenantId }

  async handleTenantWebhook(tenantId: string, body: any): Promise<boolean> {
    const token = this.getTenantBotToken(tenantId)
    if (!token) return false
    const msg = body?.message
    if (!msg) return true
    const chatId = msg.chat?.id?.toString()
    const from = msg.from?.username || msg.from?.id?.toString() || 'unknown'
    const content = msg.text || '(media)'
    const fromName = msg.from?.first_name || ''
    if (chatId) this.config.set(this.telegramChatIdKey(tenantId), chatId)
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
      let reply: string | null = ''
      if (this.webchatService) {
        try {
          reply = await this.webchatService.generatePlatformResponse(tenantId, "telegram", from, msg.text)
        } catch (e: any) {
          this.logger.error('WebchatService hatasi (tenant webhook): ' + (e?.message || ''))
          await this.logError('ai_error', 'telegram', tenantId, 'AI yanit hatasi', e?.message || 'Bilinmeyen hata', tenantId)
        }
      }
      if (reply === null) return true
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
        await this.logError('platform_error', 'telegram', tenantId, 'Mesaj gonderilemedi', e?.message || 'Bilinmeyen hata', tenantId)
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

  async sendAdminAlert(title: string, message: string): Promise<boolean> {
    const chatId = this.config.get('TELEGRAM_NOTIFICATION_CHAT_ID')
    if (!this.botToken || !chatId) return false
    const text = '🚨 <b>' + this.escapeHtml(title) + '</b>\n\n' + this.escapeHtml(message)
    return this.sendMessage(chatId, text)
  }

  async sendDirectMessage(botToken: string, chatId: string, title: string, message: string): Promise<boolean> {
    const text = '📊 <b>' + this.escapeHtml(title) + '</b>\n\n' + this.escapeHtml(message)
    try {
      const res = await lastValueFrom(this.http.post('https://api.telegram.org/bot' + botToken + '/sendMessage', {
        chat_id: chatId, text, parse_mode: 'HTML',
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

  async autoReply(chatId: string, incomingText: string, from?: string): Promise<void> {
    let reply: string | null = ''
    if (this.webchatService && this.prisma && from) {
      try {
        const tenant = await this.prisma.tenant.findFirst({ where: { slug: 'default' }, select: { id: true } })
        if (tenant) {
          reply = await this.webchatService.generatePlatformResponse(tenant.id, 'telegram', from, incomingText)
        }
      } catch (e: any) {
        this.logger.error('WebchatService hatasi (autoReply): ' + (e?.message || ''))
      }
    }
    if (reply === null) return
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

  private async logError(type: string, platform: string, tenantId: string, title: string, message: string, logTenantId?: string) {
    try {
      if (this.prisma) {
        const err = await this.prisma.errorLog.create({
          data: { type, platform, title, message: message?.slice(0, 1000) || '', tenantId: logTenantId || tenantId },
        })
        // Kritik hatalarda admin Telegram'a bildirim
        if (type === 'platform_error' || type === 'ai_error') {
          await this.sendAdminAlert(title, 'Platform: ' + platform + '\nTenant: ' + tenantId + '\nHata: ' + (message?.slice(0, 300) || ''))
        }
      }
    } catch {}
  }
}
