import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma.service'
import { TelegramService } from '../telegram/telegram.service'
import { ConfigService } from '../config.service'

@Injectable()
export class AnalyticsService {
  constructor(
    private prisma: PrismaService,
    private telegram: TelegramService,
    private config: ConfigService,
  ) {}

  async getDashboard(tenantId: string) {
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const weekStart = new Date(todayStart.getTime() - todayStart.getDay() * 86400000)
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

    const [orders, messages, customers, connectedPlatforms] = await Promise.all([
      this.orderStats(tenantId, todayStart, weekStart, monthStart),
      this.messageStats(tenantId, todayStart),
      this.customerStats(tenantId, monthStart),
      this.connectedPlatforms(tenantId),
    ])

    return { orders, messages, customers, connectedPlatforms }
  }

  private async connectedPlatforms(tenantId: string) {
    const platforms: string[] = []
    try {
      const tgConfigs = await this.prisma.telegramConfig.findMany({ where: { tenantId, active: true } })
      if (tgConfigs.length > 0) platforms.push('telegram')
    } catch {}
    try {
      const conns = await this.prisma.zernioConnection.findMany({
        where: { tenantId },
        select: { platforms: true },
      })
      conns.forEach(c => {
        if (Array.isArray(c.platforms)) c.platforms.forEach((p: any) => {
          if (typeof p === 'string') platforms.push(p)
          else if (p?.platform) platforms.push(p.platform)
        })
      })
    } catch {}
    try {
      const tgConfigs = await this.prisma.telegramConfig.findMany({ where: { tenantId, active: true } })
      if (tgConfigs.length > 0 && !platforms.includes('telegram')) platforms.push('telegram')
    } catch {}
    return [...new Set(platforms)]
  }

  async sendReport(tenantId: string): Promise<{ success: boolean; message: string }> {
    const data = await this.getDashboard(tenantId)
    const date = new Date().toLocaleDateString('tr-TR')
    let text = `📊 <b>BRUSKAPP Gunluk Rapor</b>\n📅 ${date}\n\n`

    text += `<b>📦 Siparisler</b>\n`
    text += `Toplam: ${data.orders.total} | Bu ay: ${data.orders.monthlyCount} | Bugun: ${data.orders.todayCount}\n`
    text += `Bekleyen: ${data.orders.pending} | Tamamlanan: ${data.orders.completed} | Iptal: ${data.orders.cancelled}\n\n`

    text += `<b>💬 Mesajlar</b>\n`
    text += `Toplam: ${data.messages.total} | Bugun: ${data.messages.todayCount}\n`
    if (data.messages.byPlatform?.length) {
      data.messages.byPlatform.forEach((p: any) => {
        text += `${p.platform}: ${p.count}\n`
      })
    }
    text += `\n`

    text += `<b>👥 Musteriler</b>\n`
    text += `Toplam: ${data.customers.total} | Bu ay yeni: ${data.customers.newThisMonth}`

    const botToken = this.config.get('TELEGRAM_BOT_TOKEN_' + tenantId)
    const chatId = this.config.get('TELEGRAM_NOTIFICATION_CHAT_ID_' + tenantId)
    if (!botToken || !chatId) return { success: false, message: 'Telegram bildirim ayarlari eksik' }
    const sent = await this.telegram.sendDirectMessage(botToken, chatId, '📊 Gunluk Rapor', text)
    return { success: sent, message: sent ? 'Rapor Telegram\'a gonderildi' : 'Gonderilemedi' }
  }

  private async orderStats(tenantId: string, todayStart: Date, weekStart: Date, monthStart: Date) {
    const [total, pending, completed, cancelled, today, weekly, monthly] = await Promise.all([
      this.prisma.order.count({ where: { tenantId } }),
      this.prisma.order.count({ where: { tenantId, status: 'pending' } }),
      this.prisma.order.count({ where: { tenantId, status: 'completed' } }),
      this.prisma.order.count({ where: { tenantId, status: 'cancelled' } }),
      this.prisma.order.count({ where: { tenantId, createdAt: { gte: todayStart } } }),
      this.prisma.order.count({ where: { tenantId, createdAt: { gte: weekStart } } }),
      this.prisma.order.count({ where: { tenantId, createdAt: { gte: monthStart } } }),
    ])

    return {
      total, pending, completed, cancelled,
      todayCount: today,
      weeklyCount: weekly,
      monthlyCount: monthly,
    }
  }

  private async messageStats(tenantId: string, todayStart: Date) {
    const [total, today, byPlatform] = await Promise.all([
      this.prisma.message.count({ where: { tenantId } }),
      this.prisma.message.count({ where: { tenantId, createdAt: { gte: todayStart } } }),
      this.prisma.message.groupBy({ by: ['platform'], where: { tenantId }, _count: true }),
    ])

    return {
      total,
      todayCount: today,
      byPlatform: byPlatform.map(p => ({ platform: p.platform, count: p._count })),
    }
  }

  private async customerStats(tenantId: string, monthStart: Date) {
    const uniqueFrom = await this.prisma.message.findMany({
      where: { tenantId },
      select: { from: true },
      distinct: ['from'],
    })
    const newFrom = await this.prisma.message.findMany({
      where: { tenantId, createdAt: { gte: monthStart } },
      select: { from: true },
      distinct: ['from'],
    })
    const orderCustomers = await this.prisma.order.findMany({
      where: { tenantId },
      select: { customerName: true },
      distinct: ['customerName'],
    })
    return {
      total: uniqueFrom.length + orderCustomers.length,
      newThisMonth: newFrom.length,
    }
  }
}
