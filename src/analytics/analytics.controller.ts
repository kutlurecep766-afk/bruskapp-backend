import { Controller, Get, Post, Req } from '@nestjs/common'
import { AnalyticsService } from './analytics.service'

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('dashboard')
  async getDashboard(@Req() req: any) {
    const tenantId = req.user?.tenantId
    if (!tenantId) return {}
    return this.analyticsService.getDashboard(tenantId)
  }

  @Post('report')
  async sendReport(@Req() req: any) {
    const tenantId = req.user?.tenantId
    if (!tenantId) return { success: false, message: 'Tenant bulunamadi' }
    return this.analyticsService.sendReport(tenantId)
  }
}
