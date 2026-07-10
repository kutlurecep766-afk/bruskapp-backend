import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../prisma.service'
import { MarketplaceService } from '../marketplace/marketplace.service'
import { StockMovementsService } from '../stock-movements/stock-movements.service'

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name)

  constructor(
    private prisma: PrismaService,
    private marketplaceService: MarketplaceService,
    private stockMovementsService: StockMovementsService,
  ) {}

  async create(data: {
    tenantId: string
    name: string
    description?: string
    barcode?: string
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
        barcode: data.barcode || '',
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
    barcode?: string
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

  async findByBarcode(tenantId: string, barcode: string) {
    return this.prisma.product.findFirst({ where: { tenantId, barcode } })
  }

  async addStockMovement(tenantId: string, productId: number, type: string, quantity: number, note?: string, createdById?: string) {
    return this.stockMovementsService.create({ tenantId, productId, type, quantity, note, createdById })
  }

  // Variant CRUD
  async createVariant(productId: number, data: {
    name: string; barcode?: string; price?: number; stock?: number; options?: string[]; images?: string[]
  }) {
    return this.prisma.productVariant.create({
      data: { productId, name: data.name, barcode: data.barcode || '', price: data.price, stock: data.stock ?? 0, options: data.options || [], images: data.images || [] },
    })
  }

  async getVariants(productId: number) {
    return this.prisma.productVariant.findMany({ where: { productId }, orderBy: { createdAt: 'asc' } })
  }

  async updateVariant(variantId: number, data: any) {
    return this.prisma.productVariant.update({ where: { id: variantId }, data })
  }

  async deleteVariant(variantId: number) {
    return this.prisma.productVariant.delete({ where: { id: variantId } })
  }

  async remove(id: number) {
    return this.prisma.product.delete({ where: { id } })
  }

  async syncToMarketplaces(tenantId: string, productIds: number[]) {
    const products = await this.prisma.product.findMany({
      where: { tenantId, id: { in: productIds }, barcode: { not: '' } },
    })
    if (!products.length) return { success: false, message: 'Barkodlu urun bulunamadi' }

    const providers = this.marketplaceService.getProviders()
    const results: any[] = []

    for (const provider of providers) {
      const status = await provider.getConnectionStatus(tenantId)
      if (!status.connected) continue

      const updates = products.map(p => ({
        barcode: p.barcode,
        quantity: p.stock,
      }))

      try {
        const result = await provider.updateStock(tenantId, updates)
        results.push({ platform: provider.platform, success: result.success, message: result.message })
        this.logger.log(`Stok senkronize: ${provider.platform} - ${updates.length} urun`)
      } catch (e: any) {
        results.push({ platform: provider.platform, success: false, message: e.message })
        this.logger.warn(`Stok senkronizasyon hatasi ${provider.platform}: ${e.message}`)
      }
    }

    return { success: true, results }
  }

  async updateAndSync(tenantId: string, id: number, data: { stock?: number; price?: number }) {
    const product = await this.prisma.product.update({
      where: { id },
      data,
    })
    await this.syncToMarketplaces(tenantId, [id]).catch(e => this.logger.warn('Senkronizasyon hatasi: ' + e.message))
    return product
  }
}
