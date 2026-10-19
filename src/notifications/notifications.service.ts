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

  private isComplaint(text: string): boolean {
    const t = String(text || '').toLowerCase()
    return ['şikayet', 'sikayet', 'berbat', 'kötü', 'kotu', 'rezalet', 'iade', 'memnun değil', 'memnun degil', 'yanlış', 'yanlis', 'geç geldi', 'gec geldi', 'soğuk', 'soguk', 'problem', 'sorun', 'şikayetçi', 'sikayetci', 'berbattı'].some(w => t.includes(w))
  }

  private defaultPriorityKinds(): string[] {
    return ['order', 'appointment', 'reservation', 'request']
  }

  private notificationKind(type: string): string {
    const t = String(type || '').toLowerCase()
    if (t.includes('order') || t.includes('sipariş') || t.includes('siparis')) return 'order'
    if (t.includes('appointment') || t.includes('randevu')) return 'appointment'
    if (t.includes('reservation') || t.includes('rezervasyon')) return 'reservation'
    if (t.includes('request') || t.includes('talep') || t.includes('lead') || t.includes('offer') || t.includes('teklif')) return 'request'
    if (t.includes('complaint') || t.includes('sikayet') || t.includes('şikayet')) return 'complaint'
    return 'info'
  }

  private isRequestText(text: string): boolean {
    const t = String(text || '').toLowerCase()
    return ['sipariş', 'siparis', 'fiyat', 'ne kadar', 'ücret', 'ucret', 'kaç para', 'kac para', 'randevu', 'rezervasyon', 'teklif', 'bilgi almak', 'fiyat almak', 'istiyorum', 'istiyo', 'alabilir miyim', 'var mı', 'var mi', 'menü', 'menu', 'ürün', 'urun', 'hizmet', 'sipariş vermek'].some(w => t.includes(w))
  }

  async getFeed(tenantId: string) {
    if (!tenantId) return { priority: [], secondary: [], aiFilled: false }

    let priorityKinds = this.defaultPriorityKinds()
    try {
      const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { webchatConfig: true } })
      const cfg: any = (tenant?.webchatConfig && typeof tenant.webchatConfig === 'object') ? tenant.webchatConfig : {}
      const pk = cfg?.feedSettings?.priorityKinds
      if (Array.isArray(pk) && pk.length) priorityKinds = pk.map((x: any) => String(x).toLowerCase())
    } catch {}

    const [orders, appointments, reservations, leads, messages, notifications] = await Promise.all([
      this.prisma.order.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, take: 12 }),
      this.prisma.appointment.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, take: 12 }),
      this.prisma.reservation.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, take: 12 }),
      this.prisma.lead.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, take: 10 }),
      this.prisma.message.findMany({ where: { tenantId, direction: 'incoming' }, orderBy: { createdAt: 'desc' }, take: 20 }),
      this.prisma.notification.findMany({ where: { OR: [{ tenantId }, { tenantId: null }] }, orderBy: { createdAt: 'desc' }, take: 20 }),
    ])

    const items: any[] = []

    for (const o of orders) {
      const prod = Array.isArray(o.products) ? (o.products as any[]) : []
      items.push({
        id: 'order-' + o.id,
        kind: 'order',
        title: 'Yeni Sipariş' + (o.trackingCode ? ' #' + o.trackingCode : ''),
        summary: `${o.customerName} • ${Math.round(Number(o.totalAmount) || 0)} TL • ${prod.length} ürün`,
        createdAt: o.createdAt,
        read: o.status !== 'pending',
        raw: `Siparis: ${o.customerName}, ${Math.round(Number(o.totalAmount) || 0)} TL, durum ${o.status}, urunler: ${prod.map((i: any) => i?.name || i?.productName || '').filter(Boolean).join(', ')}`,
      })
    }
    for (const a of appointments) {
      const d = a.date ? new Date(a.date).toLocaleDateString('tr-TR') : ''
      items.push({
        id: 'appt-' + a.id,
        kind: 'appointment',
        title: 'Yeni Randevu',
        summary: `${a.customerName} • ${a.service || 'Hizmet'} • ${d} ${a.time || ''}`.trim(),
        createdAt: a.createdAt,
        read: a.status !== 'pending',
        raw: `Randevu: ${a.customerName}, hizmet ${a.service}, ${d} ${a.time}, durum ${a.status}`,
      })
    }
    for (const r of reservations) {
      const d = r.date ? new Date(r.date).toLocaleDateString('tr-TR') : ''
      items.push({
        id: 'res-' + r.id,
        kind: 'reservation',
        title: 'Yeni Rezervasyon',
        summary: `${r.customerName} • ${r.guests} kişi • ${d} ${r.time || ''}`.trim(),
        createdAt: r.createdAt,
        read: r.status !== 'pending',
        raw: `Rezervasyon: ${r.customerName}, ${r.guests} kisi, ${d} ${r.time}, durum ${r.status}`,
      })
    }

    // Sadece sikayet iceren mesajlar listelenir; normal mesajlar talep sayilmaz.
    for (const m of messages) {
      if (!this.isComplaint(m.content)) continue
      items.push({
        id: 'msg-' + m.id,
        kind: 'complaint',
        title: 'Şikayet',
        summary: String(m.fromName || m.from || 'Müşteri') + ': ' + String(m.content || '').slice(0, 90),
        createdAt: m.createdAt,
        read: false,
        raw: `Mesaj (${m.platform}) ${m.fromName || m.from}: ${String(m.content || '').slice(0, 300)}`,
      })
    }
    for (const l of leads) {
      if (!this.isRequestText(String(l.needs || ''))) continue
      items.push({
        id: 'lead-' + l.id,
        kind: 'request',
        title: 'Yeni Talep',
        summary: `${l.name || 'Ziyaretçi'}${l.phone ? ' • ' + l.phone : ''}${l.needs ? ' • ' + String(l.needs).slice(0, 60) : ''}`,
        createdAt: l.createdAt,
        read: false,
        raw: `Talep: ${l.name}, tel ${l.phone}, ihtiyac ${l.needs}`,
      })
    }
    for (const n of notifications) {
      items.push({
        id: 'notif-' + n.id,
        kind: this.notificationKind(n.type),
        title: n.title,
        summary: n.message,
        createdAt: n.createdAt,
        read: n.read,
        raw: n.title + ' ' + n.message,
      })
    }

    for (const it of items) it.priority = priorityKinds.includes(it.kind) ? 1 : 2

    const priority = items.filter(i => i.priority === 1).sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
    const secondary = items.filter(i => i.priority === 2).sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))

    // AI ile ozet doldur (tek cagri)
    const candidates = [...priority.slice(0, 6), ...secondary.slice(0, 6)]
    const aiMap = await this.aiSummarize(candidates.map(c => ({ id: c.id, kind: c.kind, text: c.raw })))
    let aiFilled = false
    for (const item of [...priority, ...secondary]) {
      if (aiMap[item.id]) { item.summary = aiMap[item.id]; aiFilled = true }
      delete item.raw
    }

    return { priority, secondary, aiFilled }
  }

  private async aiSummarize(items: { id: string; kind: string; text: string }[]): Promise<Record<string, string>> {
    const key = process.env.DEEPSEEK_API_KEY || process.env.AI_API_KEY || this.config.get('DEEPSEEK_API_KEY') || this.config.get('AI_API_KEY') || ''
    const baseUrl = process.env.AI_BASE_URL || 'https://api.deepseek.com/v1/chat/completions'
    const model = process.env.AI_MODEL || 'deepseek-chat'
    if (!key || items.length === 0) return {}
    try {
      const prompt = 'Asagidaki isletme bildirimlerini Turkce, tek satir, en fazla 12 kelime olacak sekilde ozetle. Sadece su formatta JSON dizi dondur, baska hicbir yazi ekleme: [{"id":"...","ozet":"..."}].\n' +
        JSON.stringify(items)
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 20000)
      const res = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: 0, max_tokens: 1200 }),
        signal: controller.signal,
      })
      clearTimeout(timeout)
      if (!res.ok) return {}
      const data = await res.json()
      const content = data.choices?.[0]?.message?.content || ''
      const jsonStr = (content.match(/\[[\s\S]*\]/) || [content])[0]
      const arr = JSON.parse(jsonStr)
      const out: Record<string, string> = {}
      for (const a of arr) {
        if (a?.id && a?.ozet) out[String(a.id)] = String(a.ozet)
      }
      return out
    } catch {
      return {}
    }
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

  async getTelegramConfig(tenantId: string) {
    if (!tenantId) return { botToken: '', chatId: '', configured: false, enabled: false }
    const tokenKey = 'TELEGRAM_BOT_TOKEN_' + tenantId
    const chatKey = 'TELEGRAM_NOTIFICATION_CHAT_ID_' + tenantId
    const enabledKey = 'TELEGRAM_NOTIFICATIONS_ENABLED_' + tenantId
    return {
      botToken: this.config.get(tokenKey) ? this.maskToken(this.config.get(tokenKey)) : '',
      chatId: this.config.get(chatKey) || '',
      configured: !!(this.config.get(tokenKey) && this.config.get(chatKey)),
      enabled: this.config.get(enabledKey, 'true') === 'true',
    }
  }

  async setTelegramConfig(botToken: string, chatId: string, tenantId: string) {
    const testResult = await this.telegram.testConnection(botToken)
    if (!testResult.success) return { success: false, message: testResult.message }
    if (!tenantId) return { success: false, message: 'Tenant bulunamadi' }

    this.config.set('TELEGRAM_BOT_TOKEN_' + tenantId, botToken)
    this.config.set('TELEGRAM_NOTIFICATION_CHAT_ID_' + tenantId, chatId)

    await this.telegram['removeWebhook']()
    this.telegram['startPolling']()

    const sent = await this.telegram.sendMessage(chatId, '🤖 <b>BRUSKAPP Bot Aktif</b>\n\n✅ Bildirim sistemi başarıyla ayarlandı!\n💬 Artık tüm sipariş bildirimleri buraya gelecek.')

    return {
      success: true,
      message: 'Ayarlar kaydedildi' + (sent ? ' ve test mesaji gonderildi' : '') + '.',
      botInfo: testResult.botInfo,
    }
  }

  async toggleTelegram(enabled: boolean, tenantId: string) {
    const enabledKey = 'TELEGRAM_NOTIFICATIONS_ENABLED_' + tenantId
    this.config.set(enabledKey, enabled ? 'true' : 'false')
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
    return this.prisma.announcement.findMany({
      where: { isActive: true, status: 'approved' },
      orderBy: { createdAt: 'desc' },
    })
  }

  async createAnnouncement(title: string, message: string, createdBy?: string) {
    return this.prisma.announcement.create({ data: { title, message, status: 'pending', createdBy } })
  }

  async approveAnnouncement(id: string) {
    return this.prisma.announcement.update({ where: { id }, data: { status: 'approved', isActive: true } })
  }

  async updateAnnouncement(id: string, data: { title?: string; message?: string; isActive?: boolean; status?: string }) {
    return this.prisma.announcement.update({ where: { id }, data })
  }

  async deleteAnnouncement(id: string) {
    return this.prisma.announcement.delete({ where: { id } })
  }
}
