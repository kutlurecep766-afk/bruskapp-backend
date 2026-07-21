import { Controller, Get, Post, Put, Param, Body, ParseIntPipe, Req, HttpException, HttpStatus } from '@nestjs/common'
import { LeadService } from './lead.service'
import { Public } from '../auth/public.decorator'
import { PrismaService } from '../prisma.service'
import { Request } from 'express'

@Controller('leads')
export class LeadController {
  constructor(
    private leadService: LeadService,
    private prisma: PrismaService,
  ) {}

  @Public()
  @Post()
  async create(@Body() dto: any) {
    return this.leadService.create(dto)
  }

  @Get()
  async findAll(@Req() req: Request) {
    const tenantId = await this.resolveTenantId(req)
    return this.leadService.findAll(tenantId)
  }

  @Get('stats')
  async stats(@Req() req: Request) {
    const tenantId = await this.resolveTenantId(req)
    return this.leadService.getStats(tenantId)
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    const tenantId = await this.resolveTenantId(req)
    return this.leadService.findOne(id, tenantId)
  }

  @Put(':id/status')
  async updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: { status: string; notes?: string },
    @Req() req: Request,
  ) {
    const tenantId = await this.resolveTenantId(req)
    return this.leadService.updateStatus(id, dto.status, tenantId, dto.notes)
  }

  private async resolveTenantId(req: Request): Promise<string> {
    const user = req.user as any
    if (!user) throw new HttpException('Yetkilendirme gerekli', HttpStatus.UNAUTHORIZED)
    // JWT'de tenantId yoksa DB'den bul
    const tenant = await this.prisma.tenant.findFirst({
      where: { users: { some: { id: user.userId || user.sub } } },
      select: { id: true },
    })
    if (!tenant) throw new HttpException('Isletme bulunamadi', HttpStatus.NOT_FOUND)
    return tenant.id
  }
}
