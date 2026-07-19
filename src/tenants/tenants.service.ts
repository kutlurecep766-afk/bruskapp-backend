import { Injectable, NotFoundException, ConflictException } from '@nestjs/common'
import { PrismaService } from '../prisma.service'

@Injectable()
export class TenantsService {
  constructor(private prisma: PrismaService) {}

  async findByDomain(domain: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { domain } })
    if (!tenant) return null
    return {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      siteTitle: tenant.siteTitle,
      primaryColor: tenant.primaryColor,
      secondaryColor: tenant.secondaryColor,
      logoUrl: tenant.logoUrl,
      isConfigured: tenant.isConfigured,
      storefrontConfig: tenant.storefrontConfig,
    }
  }

  async findById(id: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } })
    if (!tenant) throw new NotFoundException('Tenant bulunamadı')
    return tenant
  }

  async findAll() {
    return this.prisma.tenant.findMany({ orderBy: { createdAt: 'desc' } })
  }

  async updateDomain(id: string, domain: string | null) {
    const existing = domain ? await this.prisma.tenant.findUnique({ where: { domain } }) : null
    if (existing && existing.id !== id) throw new ConflictException('Bu domain zaten başka bir işletmeye ait')
    return this.prisma.tenant.update({ where: { id }, data: { domain } })
  }

  async updateTheme(id: string, data: { siteTitle?: string; primaryColor?: string; secondaryColor?: string; logoUrl?: string; storefrontConfig?: any }) {
    return this.prisma.tenant.update({ where: { id }, data: { ...data, isConfigured: true } })
  }

  async getUsage(id: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      select: { messageCredit: true, features: true, _count: { select: { messages: { where: { direction: 'incoming', createdAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) } } } } } },
    })
    if (!tenant) throw new NotFoundException('Tenant bulunamadı')
    const totalSent = await this.prisma.message.count({
      where: { tenantId: id, direction: 'outgoing', createdAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) } },
    })
    const monthlyLimit = (tenant.features as any)?.messageLimit || 0
    return {
      messageCredit: tenant.messageCredit,
      monthlyLimit,
      monthlyUsed: totalSent,
      monthlyRemaining: monthlyLimit === 0 ? -1 : Math.max(0, monthlyLimit - totalSent),
    }
  }

  async addCredit(id: string, amount: number, reason: string, adminId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } })
    if (!tenant) throw new NotFoundException('Tenant bulunamadı')
    await this.prisma.tenant.update({
      where: { id },
      data: { messageCredit: { increment: amount } },
    })
    await this.prisma.creditLog.create({
      data: { tenantId: id, amount, reason, adminId },
    })
    this.sendNotification(id, 'credit', 'Mesaj Kredisi Eklendi', amount + ' mesaj kredisi eklendi. Sebep: ' + reason).catch(() => {})
    return { success: true, newBalance: tenant.messageCredit + amount }
  }

  async sendWeeklyWheel(id: string, adminId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } })
    if (!tenant) throw new NotFoundException('Tenant bulunamadı')
    const now = new Date()
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
    const wheel = await this.prisma.weeklyWheel.create({
      data: { tenantId: id, status: 'pending', expiresAt },
    })
    return wheel
  }

  async getTenantUsage(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { messageCredit: true, features: true },
    })
    if (!tenant) throw new NotFoundException('Tenant bulunamadı')
    const totalSent = await this.prisma.message.count({
      where: { tenantId, direction: 'outgoing', createdAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) } },
    })
    const monthlyLimit = (tenant.features as any)?.messageLimit || 0
    return {
      messageCredit: tenant.messageCredit,
      monthlyLimit,
      monthlyUsed: totalSent,
      monthlyRemaining: monthlyLimit === 0 ? -1 : Math.max(0, monthlyLimit - totalSent),
    }
  }

  async getWeeklyWheelStatus(tenantId: string) {
    const now = new Date()
    let active = await this.prisma.weeklyWheel.findFirst({
      where: { tenantId, status: 'pending', expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
    })
    let nextAvailableAt: Date | null = null
    if (!active) {
      const lastCompleted = await this.prisma.weeklyWheel.findFirst({
        where: { tenantId, status: 'completed' },
        orderBy: { createdAt: 'desc' },
      })
      if (!lastCompleted) {
        nextAvailableAt = now
      } else {
        nextAvailableAt = new Date(lastCompleted.createdAt.getTime() + 7 * 24 * 60 * 60 * 1000)
        if (now.getTime() - lastCompleted.createdAt.getTime() >= 7 * 24 * 60 * 60 * 1000) {
          const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
          active = await this.prisma.weeklyWheel.create({
            data: { tenantId, status: 'pending', expiresAt },
          })
          nextAvailableAt = now
        }
      }
    } else {
      nextAvailableAt = now
    }
    const history = await this.prisma.weeklyWheel.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 5,
    })
    return {
      hasActive: !!active,
      activeWheel: active,
      nextAvailableAt,
      history,
    }
  }

  async spinWeeklyWheel(tenantId: string) {
    const now = new Date()
    const active = await this.prisma.weeklyWheel.findFirst({
      where: { tenantId, status: 'pending', expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
    })
    if (!active) throw new NotFoundException('Aktif çark bulunamadı')
    const results = [100, 250, 500, 750, 1000]
    const result = results[Math.floor(Math.random() * results.length)]
    await this.prisma.weeklyWheel.update({
      where: { id: active.id },
      data: { status: 'completed', result },
    })
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { messageCredit: { increment: result } },
    })
    return { result, totalCredits: (await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { messageCredit: true } }))?.messageCredit }
  }

  async getCreditLogs(tenantId: string) {
    return this.prisma.creditLog.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
  }

  async getDetail(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        _count: { select: { messages: true } },
      },
    })
    if (!tenant) throw new NotFoundException('Tenant bulunamadı')
    const usage = await this.getUsage(tenantId)
    const creditLogs = await this.getCreditLogs(tenantId)
    const wheels = await this.prisma.weeklyWheel.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    })
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)
    const todayCount = await this.prisma.message.count({
      where: { tenantId, createdAt: { gte: today } },
    })
    const weekCount = await this.prisma.message.count({
      where: { tenantId, createdAt: { gte: weekAgo } },
    })
    return {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      domain: tenant.domain,
      isConfigured: tenant.isConfigured,
      createdAt: tenant.createdAt,
      ...usage,
      creditLogs,
      wheels,
      messagesToday: todayCount,
      messagesWeek: weekCount,
      totalMessages: tenant._count.messages,
    }
  }

  async getMessageStats(tenantId: string) {
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
    const [todayIn, todayOut, weekIn, weekOut, monthIn, monthOut] = await Promise.all([
      this.prisma.message.count({ where: { tenantId, direction: 'incoming', createdAt: { gte: today } } }),
      this.prisma.message.count({ where: { tenantId, direction: 'outgoing', createdAt: { gte: today } } }),
      this.prisma.message.count({ where: { tenantId, direction: 'incoming', createdAt: { gte: weekAgo } } }),
      this.prisma.message.count({ where: { tenantId, direction: 'outgoing', createdAt: { gte: weekAgo } } }),
      this.prisma.message.count({ where: { tenantId, direction: 'incoming', createdAt: { gte: monthStart } } }),
      this.prisma.message.count({ where: { tenantId, direction: 'outgoing', createdAt: { gte: monthStart } } }),
    ])
    return { todayIn, todayOut, weekIn, weekOut, monthIn, monthOut }
  }

  async sendNotification(tenantId: string, type: string, title: string, message: string) {
    return this.prisma.notification.create({
      data: { tenantId, type, title, message, read: false },
    })
  }

  async getNotifications(tenantId: string) {
    return this.prisma.notification.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    })
  }

  async markNotificationRead(id: number) {
    return this.prisma.notification.update({
      where: { id },
      data: { read: true },
    })
  }

  async deductCredit(tenantId: string): Promise<boolean> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { messageCredit: true },
    })
    if (!tenant) return false
    if (tenant.messageCredit > 0) {
      await this.prisma.tenant.update({
        where: { id: tenantId },
        data: { messageCredit: { decrement: 1 } },
      })
      if (tenant.messageCredit - 1 <= 50 && tenant.messageCredit - 1 > 0) {
        this.sendNotification(tenantId, 'warning', 'Mesaj Kredisi Azalıyor', 'Mesaj krediniz ' + (tenant.messageCredit - 1) + ' kaldı.').catch(() => {})
      }
      if (tenant.messageCredit - 1 === 0) {
        this.sendNotification(tenantId, 'error', 'Mesaj Kredisi Bitti', 'Mesaj krediniz tükendi. Yöneticinizle iletişime geçin.').catch(() => {})
      }
      return true
    }
    return false
  }
}
