import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma.service'
import { Subject } from 'rxjs'
import { PushService } from '../push/push.service'

@Injectable()
export class MessagesService {
  public newMessage$ = new Subject<any>()

  constructor(private prisma: PrismaService, private pushService: PushService) {}

  async create(data: { platform: string; from: string; content: string; messageId?: string; tenantId: string; direction?: string; fromName?: string; status?: string }) {
    const msg = await this.prisma.message.create({ data: { ...data, direction: data.direction || 'incoming', status: data.status || 'sent' } })
    this.newMessage$.next(msg)

    // Push notification for incoming messages
    if (data.direction !== 'outgoing' && data.platform !== 'web_site') {
      const senderName = data.fromName || data.from
      const platformLabel = data.platform === 'zernio_whatsapp' ? 'WhatsApp' : data.platform === 'zernio_instagram' ? 'Instagram' : data.platform === 'zernio_facebook' ? 'Facebook' : data.platform.charAt(0).toUpperCase() + data.platform.slice(1)
      this.pushService.notify(data.tenantId, {
        title: '💬 ' + platformLabel + ' - ' + senderName,
        body: data.content?.slice(0, 120) || '',
        icon: '/favicon.svg',
      }).catch(() => {})
    }

    // Auto-reply for web demo messages
    if (data.direction !== 'outgoing' && data.platform === 'web_site') {
      const reply = this.generateAutoReply(data.content)
      if (reply) {
        await this.prisma.message.create({
          data: { platform: 'web_site', from: 'AI Asistan', content: reply, direction: 'outgoing', tenantId: data.tenantId }
        })
      }
    }

    return msg
  }

  private generateAutoReply(content: string): string | null {
    const lower = content.toLowerCase()
    if (lower.includes('merhaba') || lower.includes('selam') || lower.includes('hey') || lower.includes('hi')) {
      return 'Merhaba! Bruskapp yapay zeka asistanına hoş geldiniz. Size nasıl yardımcı olabilirim? Sipariş verebilir, ürünlerimizi keşfedebilir veya bilgi alabilirsiniz.'
    }
    if (lower.includes('sipariş') || lower.includes('siparis') || lower.includes('order') || lower.includes('ısmarlamak')) {
      return 'Sipariş vermek istediğiniz için teşekkürler! Lütfen sipariş etmek istediğiniz ürünü ve adetinizi yazın. Örneğin: "2 adet kahve" veya "1 adet burger menü" şeklinde belirtebilirsiniz.'
    }
    if (lower.includes('menü') || lower.includes('menu') || lower.includes('urun') || lower.includes('ürün') || lower.includes('ne var') || lower.includes('neler var')) {
      return 'Menümüzde şu anlık: Kahve (50 TL), Latte (60 TL), Burger Menü (120 TL), Pizza (150 TL), Tatlı (80 TL). Hangisinden sipariş vermek istersiniz?'
    }
    if (lower.includes('fiyat') || lower.includes('kaç para') || lower.includes('ne kadar') || lower.includes('ücret')) {
      return 'Ürün fiyatlarımız: Kahve 50 TL, Latte 60 TL, Burger Menü 120 TL, Pizza 150 TL, Tatlı 80 TL. Detaylı bilgi için sipariş verebilir veya dilediğiniz ürünü yazabilirsiniz.'
    }
    if (lower.includes('adres') || lower.includes('nerede') || lower.includes('konum') || lower.includes('ulaşım')) {
      return 'Adresimiz: Bağdat Caddesi No:123, Kadıköy / İstanbul. Hafta içi 09:00-22:00, hafta sonu 10:00-23:00 arası hizmet vermekteyiz.'
    }
    if (lower.includes('teşekkür') || lower.includes('tesekkur') || lower.includes('sağol') || lower.includes('sagol') || lower.includes('eyvallah')) {
      return 'Rica ederiz! Başka bir isteğiniz olursa lütfen söyleyin. İyi günler dileriz!'
    }
    // Try to parse as an order (number + product pattern)
    const orderMatch = lower.match(/(\d+)\s*(adet|tane|por|porsiyon)?\s*(.+)/)
    if (orderMatch) {
      const qty = orderMatch[1]
      const product = orderMatch[3].trim()
      return `Siparişiniz alınmıştır: ${qty} adet "${product}". Toplam tutar: ${parseInt(qty) * Math.floor(Math.random() * 100 + 30)} TL. Siparişiniz hazırlanıyor, teşekkür ederiz!`
    }
    return 'Anlıyorum. Size nasıl yardımcı olabilirim? Sipariş verebilir, menümüzü görebilir veya adres bilgisi alabilirsiniz.'
  }

  async findAll(tenantId: string, query: { limit?: number; cursor?: string; platform?: string; from?: string }) {
    const take = Math.min(query.limit || 50, 100)
    const where: any = { tenantId }
    if (query.platform) where.platform = query.platform
    if (query.from) where.from = query.from
    if (query.cursor) where.id = { lt: query.cursor }

    const messages = await this.prisma.message.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: take + 1,
    })

    const hasMore = messages.length > take
    if (hasMore) messages.pop()

    return {
      messages,
      nextCursor: messages.length === take ? messages[messages.length - 1].id : null,
      hasMore,
    }
  }

  async updateStatus(messageId: string, status: string) {
    return this.prisma.message.updateMany({ where: { messageId }, data: { status } })
  }

  async findConversations(tenantId: string) {
    const rows = await this.prisma.$queryRawUnsafe<Array<{
      platform: string; from: string; fromName: string | null; lastContent: string; lastMessageAt: Date; count: bigint
    }>>(`
      SELECT platform, "from",
        (SELECT "fromName" FROM "Message" m2 WHERE m2.platform = m1.platform AND m2."from" = m1."from" AND m2."fromName" IS NOT NULL ORDER BY m2."createdAt" DESC LIMIT 1) as "fromName",
        (SELECT content FROM "Message" m2 WHERE m2.platform = m1.platform AND m2."from" = m1."from" ORDER BY m2."createdAt" DESC LIMIT 1) as "lastContent",
        MAX("createdAt") as "lastMessageAt",
        COUNT(*) as count
      FROM "Message" m1
      WHERE "tenantId" = $1
      GROUP BY platform, "from"
      ORDER BY "lastMessageAt" DESC
    `, tenantId)

    return rows.map(r => ({
      id: r.platform + ':' + r.from,
      platform: r.platform,
      from: r.from,
      fromName: r.fromName,
      lastContent: r.lastContent,
      lastMessageAt: r.lastMessageAt,
      count: Number(r.count),
    }))
  }
}
