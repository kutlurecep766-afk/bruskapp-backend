import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../prisma.service'
import { TelegramService } from '../telegram/telegram.service'

@Injectable()
export class ErrorLogService {
  private readonly logger = new Logger(ErrorLogService.name)

  constructor(
    private prisma: PrismaService,
    private telegramService: TelegramService,
  ) {}

  async logError(params: {
    type: string
    platform?: string
    tenantId?: string
    title: string
    message: string
    stack?: string
    metadata?: any
  }) {
    try {
      const err = await this.prisma.errorLog.create({
        data: {
          type: params.type,
          platform: params.platform || null,
          tenantId: params.tenantId || null,
          title: params.title,
          message: params.message?.slice(0, 2000) || '',
          stack: params.stack?.slice(0, 5000) || null,
          metadata: params.metadata || {},
        },
      })
      this.logger.warn(`[${params.type}] ${params.title}: ${params.message?.slice(0, 100)}`)

      if (params.type === 'platform_error' || params.type === 'ai_error' || params.type === 'system_error') {
        const tenantSlug = params.tenantId ? ` (Tenant: ${params.tenantId.slice(0, 8)})` : ''
        await this.telegramService.sendAdminAlert(
          params.title,
          `Tip: ${params.type}${tenantSlug}\nPlatform: ${params.platform || '-'}\nDetay: ${(params.message || '').slice(0, 400)}`
        )
      }

      return err
    } catch (e) {
      this.logger.error('ErrorLog kaydetme hatasi: ' + (e?.message || ''))
    }
  }

  async getErrors(query: {
    tenantId?: string
    type?: string
    platform?: string
    limit?: number
    cursor?: string
    acknowledged?: boolean
  }) {
    const take = Math.min(query.limit || 50, 100)
    const where: any = {}
    if (query.tenantId) where.tenantId = query.tenantId
    if (query.type) where.type = query.type
    if (query.platform) where.platform = query.platform
    if (query.acknowledged !== undefined) where.acknowledged = query.acknowledged
    if (query.cursor) where.id = { lt: query.cursor }

    const errors = await this.prisma.errorLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: take + 1,
    })

    const hasMore = errors.length > take
    if (hasMore) errors.pop()

    return {
      errors,
      nextCursor: errors.length === take ? errors[errors.length - 1].id : null,
      hasMore,
      total: await this.prisma.errorLog.count({ where }),
    }
  }

  async acknowledgeError(id: string) {
    return this.prisma.errorLog.update({
      where: { id },
      data: { acknowledged: true },
    })
  }

  async acknowledgeAll(tenantId?: string) {
    const where: any = { acknowledged: false }
    if (tenantId) where.tenantId = tenantId
    return this.prisma.errorLog.updateMany({
      where,
      data: { acknowledged: true },
    })
  }

  async getStats(tenantId?: string) {
    const where: any = {}
    if (tenantId) where.tenantId = tenantId
    const total = await this.prisma.errorLog.count({ where })
    const unacknowledged = await this.prisma.errorLog.count({ where: { ...where, acknowledged: false } })
    const byType = await this.prisma.errorLog.groupBy({
      by: ['type'],
      where,
      _count: { type: true },
      orderBy: { _count: { type: 'desc' } },
    })
    const last24h = await this.prisma.errorLog.count({
      where: { ...where, createdAt: { gte: new Date(Date.now() - 86400000) } },
    })
    return { total, unacknowledged, last24h, byType: byType.map(b => ({ type: b.type, count: b._count.type })) }
  }
}
