import { Controller, Get, Post, Param, Req, NotFoundException, Body } from '@nestjs/common'
import { TenantsService } from './tenants.service'

@Controller('tenant')
export class TenantCreditsController {
  constructor(private tenantsService: TenantsService) {}

  @Get('messages/usage')
  async getUsage(@Req() req: any) {
    if (!req.user?.tenantId) throw new NotFoundException('Tenant bulunamadı')
    return this.tenantsService.getTenantUsage(req.user.tenantId)
  }

  @Get('weekly-wheel')
  async getWeeklyWheel(@Req() req: any) {
    if (!req.user?.tenantId) throw new NotFoundException('Tenant bulunamadı')
    return this.tenantsService.getWeeklyWheelStatus(req.user.tenantId)
  }

  @Post('weekly-wheel/spin')
  async spinWheel(@Req() req: any) {
    if (!req.user?.tenantId) throw new NotFoundException('Tenant bulunamadı')
    return this.tenantsService.spinWeeklyWheel(req.user.tenantId)
  }

  @Get('notifications')
  async getNotifications(@Req() req: any) {
    if (!req.user?.tenantId) throw new NotFoundException('Tenant bulunamadı')
    return this.tenantsService.getNotifications(req.user.tenantId)
  }

  @Post('notifications/:id/read')
  async markRead(@Req() req: any, @Param('id') id: string) {
    if (!req.user?.tenantId) throw new NotFoundException('Tenant bulunamadı')
    return this.tenantsService.markNotificationRead(parseInt(id, 10))
  }

  @Get('messages/stats')
  async getStats(@Req() req: any) {
    if (!req.user?.tenantId) throw new NotFoundException('Tenant bulunamadı')
    return this.tenantsService.getMessageStats(req.user.tenantId)
  }

  @Post('ai-toggle')
  async setAiToggle(@Req() req: any, @Body() body: { enabled: boolean }) {
    if (!req.user?.tenantId) throw new NotFoundException('Tenant bulunamadi')
    return this.tenantsService.setAiToggle(req.user.tenantId, body.enabled)
  }
}
