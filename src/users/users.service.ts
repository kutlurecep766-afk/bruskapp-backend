import { Injectable, NotFoundException, ConflictException } from '@nestjs/common'
import * as bcrypt from 'bcryptjs'
import { PrismaService } from '../prisma.service'

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.user.findMany({
      include: { tenant: { select: { name: true, slug: true } } },
      orderBy: { createdAt: 'desc' },
    })
  }

  async findByTenant(tenantId: string) {
    return this.prisma.user.findMany({
      where: { tenantId },
      select: { id: true, email: true, name: true, role: true, status: true, createdAt: true, updatedAt: true },
      orderBy: { createdAt: 'desc' },
    })
  }

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { tenant: { select: { name: true, slug: true } } },
    })
    if (!user) throw new NotFoundException('Kullanici bulunamadi')
    return user
  }

  async create(data: { email: string; password: string; name?: string; role?: string; permissions?: string[]; tenantId: string }) {
    const existing = await this.prisma.user.findUnique({ where: { email: data.email } })
    if (existing) throw new ConflictException('Bu e-posta zaten kayitli')
    const passwordHash = await bcrypt.hash(data.password, 12)
    return this.prisma.user.create({
      data: {
        email: data.email,
        passwordHash,
        name: data.name || '',
        role: data.role || 'WAITER',
        permissions: data.permissions || [],
        tenantId: data.tenantId,
      },
      select: { id: true, email: true, name: true, role: true, status: true, createdAt: true },
    })
  }

  async update(id: string, data: { name?: string; role?: string }) {
    const user = await this.prisma.user.findUnique({ where: { id } })
    if (!user) throw new NotFoundException('Kullanici bulunamadi')
    return this.prisma.user.update({
      where: { id },
      data,
      select: { id: true, email: true, name: true, role: true, status: true },
    })
  }

  async remove(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } })
    if (!user) throw new NotFoundException('Kullanici bulunamadi')
    await this.prisma.user.delete({ where: { id } })
    return { success: true }
  }

  async restrict(id: string) {
    await this.prisma.refreshToken.deleteMany({ where: { userId: id } })
    return this.prisma.user.update({ where: { id }, data: { status: 'restricted' }, select: { id: true, email: true, name: true, status: true, role: true } })
  }

  async unrestrict(id: string) {
    return this.prisma.user.update({ where: { id }, data: { status: 'active' }, select: { id: true, email: true, name: true, status: true, role: true } })
  }

  async getUserStatus(userId: string) {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { status: true, id: true } })
    if (!u) return null
    return { status: u.status }
  }
}
