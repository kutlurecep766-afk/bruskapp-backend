import { Controller, Get, Post, Patch, Body, Param, Query, Req, ForbiddenException } from '@nestjs/common'
import { TenantsService } from './tenants.service'
import { Public } from '../auth/public.decorator'

@Controller('tenants')
export class TenantsController {
  constructor(private tenantsService: TenantsService) {}

  @Get('me')
  async findMe(@Req() req: any) {
    if (!req.user?.tenantId) return { tenant: null }
    const tenant = await this.tenantsService.findById(req.user.tenantId)
    return { tenant }
  }

  @Public()
  @Get('public')
  async findByDomain(@Query('domain') domain: string) {
    if (!domain) return { tenant: null }
    const tenant = await this.tenantsService.findByDomain(domain)
    return { tenant }
  }

  @Get()
  async findAll(@Req() req: any) {
    if (req.user?.role !== 'SUPER_ADMIN') throw new ForbiddenException('Yetkiniz yok')
    return this.tenantsService.findAll()
  }

  @Get(':id')
  async findById(@Req() req: any, @Param('id') id: string) {
    if (req.user?.role !== 'SUPER_ADMIN') throw new ForbiddenException('Yetkiniz yok')
    return this.tenantsService.findById(id)
  }

  @Patch(':id/domain')
  async updateDomain(@Req() req: any, @Param('id') id: string, @Body('domain') domain: string | null) {
    if (req.user?.role !== 'SUPER_ADMIN') throw new ForbiddenException('Yetkiniz yok')
    return this.tenantsService.updateDomain(id, domain)
  }

  @Patch(':id/theme')
  async updateTheme(@Req() req: any, @Param('id') id: string, @Body() body: { siteTitle?: string; primaryColor?: string; secondaryColor?: string; logoUrl?: string; storefrontConfig?: any }) {
    if (req.user?.role !== 'SUPER_ADMIN' && req.user?.tenantId !== id) throw new ForbiddenException('Yetkiniz yok')
    return this.tenantsService.updateTheme(id, body)
  }

  @Post(':id/credit')
  async addCredit(@Req() req: any, @Param('id') id: string, @Body('amount') amount: number, @Body('reason') reason: string) {
    if (req.user?.role !== 'SUPER_ADMIN') throw new ForbiddenException('Yetkiniz yok')
    if (!amount || amount < 1) throw new ForbiddenException('Gecerli bir miktar girin')
    if (!reason || !reason.trim()) throw new ForbiddenException('Sebep zorunludur')
    return this.tenantsService.addCredit(id, amount, reason, req.user.userId)
  }

  @Get(':id/usage')
  async getUsage(@Req() req: any, @Param('id') id: string) {
    if (req.user?.role !== 'SUPER_ADMIN') throw new ForbiddenException('Yetkiniz yok')
    return this.tenantsService.getUsage(id)
  }

  @Get('usage/all')
  async getAllUsage(@Req() req: any) {
    if (req.user?.role !== 'SUPER_ADMIN') throw new ForbiddenException('Yetkiniz yok')
    const tenants = await this.tenantsService.findAll()
    const usage = await Promise.all(tenants.map(async (t: any) => {
      const u = await this.tenantsService.getUsage(t.id)
      return { id: t.id, name: t.name, slug: t.slug, ...u }
    }))
    return usage
  }

  @Get(':id/detail')
  async getDetail(@Req() req: any, @Param('id') id: string) {
    if (req.user?.role !== 'SUPER_ADMIN') throw new ForbiddenException('Yetkiniz yok')
    return this.tenantsService.getDetail(id)
  }

  @Get(':id/credit-logs')
  async getCreditLogs(@Req() req: any, @Param('id') id: string) {
    if (req.user?.role !== 'SUPER_ADMIN') throw new ForbiddenException('Yetkiniz yok')
    return this.tenantsService.getCreditLogs(id)
  }
}
