import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../prisma.service'

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name)

  constructor(private prisma: PrismaService) {}

  async create(data: {
    tenantId: string
    name: string
    description?: string
    price: number
    images?: string[]
    category?: string
    stock?: number
    active?: boolean
  }) {
    return this.prisma.product.create({
      data: {
        tenantId: data.tenantId,
        name: data.name,
        description: data.description || '',
        price: data.price,
        images: data.images || [],
        category: data.category || '',
        stock: data.stock ?? 0,
        active: data.active ?? true,
      },
    })
  }

  async findAll(tenantId: string) {
    return this.prisma.product.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    })
  }

  async findById(id: number) {
    return this.prisma.product.findUnique({ where: { id } })
  }

  async findByTenantSlug(slug: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { slug } })
    if (!tenant) return null
    return this.prisma.product.findMany({
      where: { tenantId: tenant.id, active: true },
      orderBy: { createdAt: 'desc' },
    })
  }

  async update(id: number, data: {
    name?: string
    description?: string
    price?: number
    images?: string[]
    category?: string
    stock?: number
    active?: boolean
  }) {
    return this.prisma.product.update({
      where: { id },
      data,
    })
  }

  async remove(id: number) {
    return this.prisma.product.delete({ where: { id } })
  }
}
