import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../prisma.service'

@Injectable()
export class StockMovementsService {
  private readonly logger = new Logger(StockMovementsService.name)

  constructor(private prisma: PrismaService) {}

  async create(data: {
    tenantId: string
    productId: number
    type: string
    quantity: number
    reference?: string
    note?: string
    createdById?: string
  }) {
    const product = await this.prisma.product.findUnique({ where: { id: data.productId } })
    if (!product) throw new Error('Ürün bulunamadı')
    const newBalance = product.stock + data.quantity
    if (newBalance < 0) throw new Error('Yetersiz stok')

    await this.prisma.product.update({
      where: { id: data.productId },
      data: { stock: newBalance },
    })

    return this.prisma.stockMovement.create({
      data: {
        tenantId: data.tenantId,
        productId: data.productId,
        type: data.type,
        quantity: data.quantity,
        balance: newBalance,
        reference: data.reference,
        note: data.note,
        createdById: data.createdById,
      },
    })
  }

  async findAll(tenantId: string, productId?: number, page = 0, size = 50) {
    const where: any = { tenantId }
    if (productId) where.productId = productId

    const [items, total] = await Promise.all([
      this.prisma.stockMovement.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: page * size,
        take: size,
        include: { product: { select: { id: true, name: true, barcode: true } } },
      }),
      this.prisma.stockMovement.count({ where }),
    ])
    return { items, total }
  }
}
