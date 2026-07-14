import { Injectable } from '@nestjs/common'
import * as webpush from 'web-push'
import { ConfigService } from '../config.service'
import { TelegramService } from '../telegram/telegram.service'
import { PrismaService } from '../prisma.service'

@Injectable()
export class NotificationsService {
  private sseClients: Set<(data: any) => void> = new Set()
  private businessClients: Map<string, Set<(data: any) => void>> = new Map()

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private telegram: TelegramService
  ) {
    const publicKey = this.config.get('VAPID_PUBLIC_KEY') || ''
    const privateKey = this.config.get('VAPID_PRIVATE_KEY') || ''
    const email = this.config.get('VAPID_EMAIL') || 'admin@bruskapp.com'
    if (publicKey && privateKey) {
      webpush.setVapidDetails('mailto:' + email, publicKey, privateKey)
    }
  }

  addClient(callback: (data: any) => void) {
    this.sseClients.add(callback)
    return () => this.sseClients.delete(callback)
  }

  addBusinessClient(businessId: string, callback: (data: any) => void) {
    if (!this.businessClients.has(businessId)) {
      this.businessClients.set(businessId, new Set())
    }
    this.businessClients.get(businessId)!.add(callback)
    return () => {
      const clients = this.businessClients.get(businessId)
      if (clients) {
        clients.delete(callback)
        if (clients.size === 0) this.businessClients.delete(businessId)
      }
    }
  }

  async createNotification(type: string, title: string, message: string) {
    const notification = await this.prisma.notification.create({
      data: { type, title, message, read: false },
    })
    const payload = { id: notification.id, type, title, message, createdAt: notification.createdAt }
    this.sseClients.forEach(cb => cb(payload))
    // Push to business-specific SSE clients (by type as businessId)
    const businessClients = this.businessClients.get(type)
    if (businessClients) businessClients.forEach(cb => cb(payload))
    // Send via Telegram if enabled and configured
    if (this.config.get('TELEGRAM_NOTIFICATIONS_ENABLED', 'true') === 'true') {
      this.telegram.sendNotification(title, message).catch(() => {})
    }
    // Send push to all subscribers
    const pushPayload = JSON.stringify(payload)
    this.subscriptions.forEach(sub => {
      try {
        webpush.sendNotification(sub, pushPayload).catch((err: any) => {
          // Remove invalid subscriptions
          if (err.statusCode === 410 || err.statusCode === 404) {
            this.subscriptions.delete(sub.endpoint)
          }
        })
      } catch {}
    })
    return notification
  }

  async getNotifications(limit = 50) {
    return this.prisma.notification.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
  }

  async markRead(id: number) {
    return this.prisma.notification.update({ where: { id }, data: { read: true } })
  }

  async markAllRead() {
    return this.prisma.notification.updateMany({ data: { read: true } })
  }

  
  private subscriptions: Map<string, { endpoint: string; keys: { p256dh: string; auth: string } }> = new Map()

  subscribe(endpoint: string, keys: { p256dh: string; auth: string }) {
    this.subscriptions.set(endpoint, { endpoint, keys })
    console.log('Push subscribed:', endpoint.substring(0, 50) + '...')
    return { ok: true }
  }
async sendTest(platform: string) {
    return this.createNotification(
      platform,
      '🛒 Yeni Sipariş',
      '📢 Test bildirimi - ' + platform + ' üzerinden yeni sipariş alındı'
    )
  }

  async getTelegramConfig() {
    return {
      botToken: this.config.get('TELEGRAM_BOT_TOKEN') ? this.maskToken(this.config.get('TELEGRAM_BOT_TOKEN')) : '',
      chatId: this.config.get('TELEGRAM_NOTIFICATION_CHAT_ID') || '',
      configured: !!(this.config.get('TELEGRAM_BOT_TOKEN') && this.config.get('TELEGRAM_NOTIFICATION_CHAT_ID')),
      enabled: this.config.get('TELEGRAM_NOTIFICATIONS_ENABLED', 'true') === 'true',
    }
  }

  async setTelegramConfig(botToken: string, chatId: string) {
    const testResult = await this.telegram.testConnection(botToken)
    if (!testResult.success) return { success: false, message: testResult.message }

    this.config.set('TELEGRAM_BOT_TOKEN', botToken)
    this.config.set('TELEGRAM_NOTIFICATION_CHAT_ID', chatId)

    await this.telegram['removeWebhook']()
    this.telegram['startPolling']()

    const sent = await this.telegram.sendMessage(chatId, '🤖 <b>BRUSKAPP Bot Aktif</b>\n\n✅ Bildirim sistemi başarıyla ayarlandı!\n💬 Artık tüm sipariş bildirimleri buraya gelecek.')

    return {
      success: true,
      message: 'Ayarlar kaydedildi' + (sent ? ' ve test mesaji gonderildi' : '') + '.',
      botInfo: testResult.botInfo,
    }
  }

  async toggleTelegram(enabled: boolean) {
    this.config.set('TELEGRAM_NOTIFICATIONS_ENABLED', enabled ? 'true' : 'false')
    return { enabled, message: enabled ? 'Telegram bildirimleri aktif' : 'Telegram bildirimleri devre disi' }
  }

  private maskToken(token: string): string {
    if (token.length < 10) return token
    return token.substring(0, 6) + '...' + token.substring(token.length - 4)
  }

  // Notification Preferences
  async getPreferences(tenantId: string) {
    const prefs = await this.prisma.notificationPreference.findUnique({ where: { tenantId } })
    return prefs || { tenantId, newOrder: true, lowStock: true, newMessage: true }
  }

  async setPreferences(tenantId: string, data: { newOrder?: boolean; lowStock?: boolean; newMessage?: boolean }) {
    return this.prisma.notificationPreference.upsert({
      where: { tenantId },
      create: { tenantId, ...data },
      update: data,
    })
  }

  // Announcements
  async getAnnouncements() {
    return this.prisma.announcement.findMany({ orderBy: { createdAt: 'desc' } })
  }

  async getActiveAnnouncements() {
    return this.prisma.announcement.findMany({ where: { isActive: true }, orderBy: { createdAt: 'desc' } })
  }

  async createAnnouncement(title: string, message: string, createdBy?: string) {
    return this.prisma.announcement.create({ data: { title, message, createdBy } })
  }

  async updateAnnouncement(id: string, data: { title?: string; message?: string; isActive?: boolean }) {
    return this.prisma.announcement.update({ where: { id }, data })
  }

  async deleteAnnouncement(id: string) {
    return this.prisma.announcement.delete({ where: { id } })
  }
}
