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
}
