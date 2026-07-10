import type { PrismaClient } from '@prisma/client'

export async function deductStockForOrderItems(
  prisma: PrismaClient,
  tenantId: string,
  platform: string,
  items: { barcode: string; quantity: number; name?: string }[],
): Promise<number> {
  let deducted = 0
  for (const item of items) {
    if (!item.barcode) continue
    const local = await (prisma as any).product.findFirst({ where: { tenantId, barcode: item.barcode } })
    if (!local) continue

    const qty = Math.abs(item.quantity)
    const newBalance = local.stock - qty
    if (newBalance < 0) continue

    await (prisma as any).product.update({
      where: { id: local.id },
      data: { stock: newBalance },
    })

    await (prisma as any).stockMovement.create({
      data: {
        tenantId,
        productId: local.id,
        type: 'ORDER',
        quantity: -qty,
        balance: newBalance,
        reference: platform,
        note: `${platform} siparişi - ${item.name || item.barcode} x${qty}`,
      },
    })

    // Dusuk stok kontrolu
    if (newBalance <= (local.lowStockThreshold || 5)) {
      await (prisma as any).notification.create({
        data: {
          type: 'low_stock',
          title: 'Düşük Stok Uyarısı',
          message: `${local.name} (${local.barcode}) ürününün stoku ${newBalance} adete düştü.`,
          tenantId,
          productId: local.id,
        },
      }).catch(() => {})
    }
    deducted++
  }
  return deducted
}
