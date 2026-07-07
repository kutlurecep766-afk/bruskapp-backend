import type { OrderInput, OrderItemInput } from './marketplace-order-adapter.interface'

export function n11ToCommon(raw: any, tenantId: string): OrderInput {
  const productsArr: any[] = raw.products?.product ? (Array.isArray(raw.products.product) ? raw.products.product : [raw.products.product]) : []
  const items: OrderItemInput[] = productsArr.map((l: any) => ({
    platformItemId: String(l.id || ''),
    barcode: l.sellerStockCode || '',
    title: l.productName || l.title || '',
    quantity: parseInt(l.quantity) || 1,
    price: parseFloat(l.salesPrice) || 0,
  }))

  return {
    tenantId,
    platform: 'n11',
    marketplaceOrderId: String(raw.id || ''),
    orderNumber: raw.orderNumber || String(raw.id || ''),
    customerName: raw.buyerName || raw.shippingAddress?.name || '',
    customerPhone: raw.buyerPhone || raw.shippingAddress?.phone || '',
    customerEmail: raw.buyerEmail || '',
    deliveryAddress: raw.shippingAddress ? {
      name: raw.shippingAddress.name,
      city: raw.shippingAddress.city,
      district: raw.shippingAddress.town,
      fullAddress: raw.shippingAddress.fullAddress,
      phone: raw.shippingAddress.phone,
    } : undefined,
    totalAmount: parseFloat(raw.totalAmount) || 0,
    discountPrice: parseFloat(raw.discountPrice) || 0,
    shippingPrice: parseFloat(raw.cargoAmount) || 0,
    currency: 'TRY',
    paymentType: raw.paymentType || '',
    status: String(raw.status || ''),
    marketplaceStatus: String(raw.status || ''),
    paymentStatus: raw.paymentType || '',
    isPickedUp: false,
    rawPayload: raw,
    orderDate: raw.createDate || '',
    items,
  }
}
