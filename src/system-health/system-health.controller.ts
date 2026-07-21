import { Controller, Get, Req } from '@nestjs/common'
import { PrismaService } from '../prisma.service'

@Controller('system')
export class SystemHealthController {
  constructor(private prisma: PrismaService) {}

  @Get('health')
  async health() {
    const checks: any = { status: 'ok', timestamp: new Date().toISOString() }

    // DB check
    try {
      await this.prisma.$queryRawUnsafe('SELECT 1')
      checks.database = 'connected'
    } catch {
      checks.database = 'error'
      checks.status = 'degraded'
    }

    // Last message per platform
    try {
      const lastMsgs = await this.prisma.$queryRawUnsafe<Array<{ platform: string; lastMsg: Date }>>(`
        SELECT platform, MAX("createdAt") as "lastMsg" FROM "Message" GROUP BY platform ORDER BY platform
      `)
      checks.lastMessages = lastMsgs
    } catch { checks.lastMessages = [] }

    // Error stats
    try {
      const errorStats = await this.prisma.$queryRawUnsafe<Array<{ total: bigint; last24h: bigint; unacknowledged: bigint }>>(`
        SELECT COUNT(*)::bigint as total,
          COUNT(*) FILTER (WHERE "createdAt" > NOW() - INTERVAL '24 hours')::bigint as "last24h",
          COUNT(*) FILTER (WHERE "acknowledged" = false)::bigint as unacknowledged
        FROM "ErrorLog"
      `)
      checks.errors = errorStats[0] ? { total: Number(errorStats[0].total), last24h: Number(errorStats[0].last24h), unacknowledged: Number(errorStats[0].unacknowledged) } : { total: 0, last24h: 0, unacknowledged: 0 }
    } catch { checks.errors = { total: 0, last24h: 0, unacknowledged: 0 } }

    // Today's message count
    try {
      const msgToday = await this.prisma.$queryRawUnsafe<Array<{ count: bigint }>>(`
        SELECT COUNT(*)::bigint as count FROM "Message" WHERE "createdAt" > NOW() - INTERVAL '24 hours'
      `)
      checks.messagesLast24h = Number(msgToday[0]?.count || 0)
    } catch { checks.messagesLast24h = 0 }

    // Lead count
    try {
      const leadCount = await this.prisma.lead.count()
      checks.leads = leadCount
    } catch { checks.leads = 0 }

    // Tenant count
    try {
      const tenantCount = await this.prisma.tenant.count()
      checks.tenants = tenantCount
    } catch { checks.tenants = 0 }

    return checks
  }
}
