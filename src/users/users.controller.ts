import { Controller, Get, Post, Patch, Delete, Body, Param, Req, ForbiddenException, UnauthorizedException } from '@nestjs/common'
import { UsersService } from './users.service'

@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get()
  async findAll(@Req() req: any) {
    if (req.user?.role === 'SUPER_ADMIN') return this.usersService.findAll()
    if (req.user?.tenantId) return this.usersService.findByTenant(req.user.tenantId)
    throw new ForbiddenException('Yetkiniz yok')
  }

  @Get('me')
  async getMe(@Req() req: any) {
    if (!req.user?.userId) throw new UnauthorizedException()
    const u = await this.usersService.findById(req.user.userId)
    const { passwordHash, ...safe } = u
    return safe
  }

  @Get('me/status')
  async getMyStatus(@Req() req: any) {
    if (!req.user?.userId) throw new UnauthorizedException()
    const u = await this.usersService.getUserStatus(req.user.userId)
    if (!u) throw new UnauthorizedException()
    return u
  }

  @Post()
  async create(@Req() req: any, @Body() body: { email: string; password: string; name?: string; role?: string }) {
    const allowedRoles = ['SUPER_ADMIN', 'TENANT_ADMIN']
    if (!allowedRoles.includes(req.user?.role)) throw new ForbiddenException('Yetkiniz yok')
    const tenantId = req.user.role === 'SUPER_ADMIN' ? (body as any).tenantId : req.user.tenantId
    if (!tenantId) throw new ForbiddenException('Tenant bilgisi gerekli')
    return this.usersService.create({
      email: body.email,
      password: body.password,
      name: body.name || '',
      role: body.role || 'WAITER',
      tenantId,
    })
  }

  @Patch(':id')
  async update(@Req() req: any, @Param('id') id: string, @Body() body: { name?: string; role?: string }) {
    const user = await this.usersService.findById(id)
    if (req.user?.role !== 'SUPER_ADMIN' && user.tenantId !== req.user?.tenantId) {
      throw new ForbiddenException('Yetkiniz yok')
    }
    return this.usersService.update(id, body)
  }

  @Delete(':id')
  async remove(@Req() req: any, @Param('id') id: string) {
    const user = await this.usersService.findById(id)
    if (req.user?.role !== 'SUPER_ADMIN' && user.tenantId !== req.user?.tenantId) {
      throw new ForbiddenException('Yetkiniz yok')
    }
    return this.usersService.remove(id)
  }

  @Patch(':id/restrict')
  async restrict(@Req() req: any, @Param('id') id: string) {
    const user = await this.usersService.findById(id)
    if (req.user?.role !== 'SUPER_ADMIN' && user.tenantId !== req.user?.tenantId) {
      throw new ForbiddenException('Yetkiniz yok')
    }
    return this.usersService.restrict(id)
  }

  @Patch(':id/unrestrict')
  async unrestrict(@Req() req: any, @Param('id') id: string) {
    const user = await this.usersService.findById(id)
    if (req.user?.role !== 'SUPER_ADMIN' && user.tenantId !== req.user?.tenantId) {
      throw new ForbiddenException('Yetkiniz yok')
    }
    return this.usersService.unrestrict(id)
  }
}
