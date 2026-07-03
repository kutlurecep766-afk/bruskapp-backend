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
}
