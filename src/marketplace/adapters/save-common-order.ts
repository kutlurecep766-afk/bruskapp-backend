import type { PrismaClient } from '@prisma/client'
import type { OrderInput } from './marketplace-order-adapter.interface'
import { deductStockForOrderItems } from './deduct-stock'

export async function saveCommonOrder(
  prisma: PrismaClient,
  common: OrderInput,
): Promise<void> {
  const order = await prisma.marketplaceOrder.upsert({
    where: { marketplaceOrderId: common.marketplaceOrderId },
    update: {
      status: common.status,
      marketplaceStatus: common.marketplaceStatus,
      customerName: common.customerName,
      customerPhone: common.customerPhone,
      customerEmail: common.customerEmail,
      deliveryAddress: common.deliveryAddress,
      totalAmount: common.totalAmount,
      discountPrice: common.discountPrice,
      shippingPrice: common.shippingPrice,
      paymentType: common.paymentType,
      cargoStatus: common.cargoStatus,
      cargoCompany: common.cargoCompany,
      cargoTracking: common.cargoTracking,
      paymentStatus: common.paymentStatus,
      isPickedUp: common.isPickedUp,
      rawPayload: common.rawPayload,
      updatedAt: new Date(),
    },
    create: {
      tenantId: common.tenantId,
      platform: common.platform,
      marketplaceOrderId: common.marketplaceOrderId,
      orderNumber: common.orderNumber,
      customerName: common.customerName,
      customerPhone: common.customerPhone,
      customerEmail: common.customerEmail,
      deliveryAddress: common.deliveryAddress,
      totalAmount: common.totalAmount,
      discountPrice: common.discountPrice,
      shippingPrice: common.shippingPrice,
      currency: common.currency || 'TRY',
      paymentType: common.paymentType,
      status: 'pending',
      marketplaceStatus: common.marketplaceStatus,
      cargoStatus: common.cargoStatus,
      cargoCompany: common.cargoCompany,
      cargoTracking: common.cargoTracking,
      paymentStatus: common.paymentStatus,
      isPickedUp: common.isPickedUp,
      rawPayload: common.rawPayload,
      orderDate: common.orderDate ? new Date(common.orderDate) : null,
    },
  })

  if (common.items && common.items.length > 0) {
    await prisma.marketplaceOrderItem.deleteMany({ where: { orderId: order.id } })
    await prisma.marketplaceOrderItem.createMany({
      data: common.items.map((item) => ({
        orderId: order.id,
        platformItemId: item.platformItemId,
        sku: item.sku,
        barcode: item.barcode,
        title: item.title,
        quantity: item.quantity,
        price: item.price,
        options: item.options,
      })),
    })

    // Stok dusurme (background, hata vermesin)
    deductStockForOrderItems(
      prisma, common.tenantId, common.platform,
      common.items.map(i => ({ barcode: i.barcode || '', quantity: i.quantity, name: i.title }))
    ).catch(() => {})
  }
}
