import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../prisma.service'
import { StockMovementsService } from '../stock-movements/stock-movements.service'

@Injectable()
export class PurchaseInvoicesService {
  private readonly logger = new Logger(PurchaseInvoicesService.name)

  constructor(
    private prisma: PrismaService,
    private stockMovements: StockMovementsService,
  ) {}

  async create(data: {
    tenantId: string
    invoiceNo: string
    supplier: string
    date: string
    totalAmount: number
    currency?: string
    note?: string
    items: { productId: number; quantity: number; unitPrice: number }[]
    createdById?: string
  }) {
    const invoice = await this.prisma.purchaseInvoice.create({
      data: {
        tenantId: data.tenantId,
        invoiceNo: data.invoiceNo,
        supplier: data.supplier,
        date: new Date(data.date),
        totalAmount: data.totalAmount,
        currency: data.currency || 'TRY',
        note: data.note,
        items: {
          create: await Promise.all(data.items.map(async (item) => {
            const product = await this.prisma.product.findUnique({ where: { id: item.productId } })
            if (!product) throw new NotFoundException(`Ürün bulunamadı: ${item.productId}`)
            return {
              productId: item.productId,
              productName: product.name,
              barcode: product.barcode,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              totalPrice: item.quantity * item.unitPrice,
            }
          })),
        },
      },
      include: { items: true },
    })

    for (const item of data.items) {
      await this.stockMovements.create({
        tenantId: data.tenantId,
        productId: item.productId,
        type: 'PURCHASE_INVOICE',
        quantity: item.quantity,
        reference: data.invoiceNo,
        note: `${data.supplier} - ${data.invoiceNo}`,
        createdById: data.createdById,
      })
    }

    return invoice
  }

  async findAll(tenantId: string, page = 0, size = 50) {
    const [items, total] = await Promise.all([
      this.prisma.purchaseInvoice.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        skip: page * size,
        take: size,
        include: { items: { include: { product: { select: { id: true, name: true, barcode: true } } } } },
      }),
      this.prisma.purchaseInvoice.count({ where: { tenantId } }),
    ])
    return { items, total }
  }

  async findById(tenantId: string, id: number) {
    const invoice = await this.prisma.purchaseInvoice.findFirst({
      where: { id, tenantId },
      include: { items: { include: { product: { select: { id: true, name: true, barcode: true } } } } },
    })
    if (!invoice) throw new NotFoundException('Fatura bulunamadı')
    return invoice
  }
}
