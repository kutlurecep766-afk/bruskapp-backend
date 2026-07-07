import type { OrderInput, OrderItemInput } from './marketplace-order-adapter.interface'

export function hepsiburadaToCommon(raw: any, tenantId: string): OrderInput {
  const lines: any[] = raw.lines || raw.items || []
  const items: OrderItemInput[] = lines.map((l: any) => ({
    platformItemId: String(l.id || ''),
    barcode: l.merchantSku || l.barcode || '',
    title: l.productName || l.title || '',
    quantity: l.quantity || 1,
    price: parseFloat(l.price) || 0,
  }))

  return {
    tenantId,
    platform: 'hepsiburada',
    marketplaceOrderId: String(raw.id || raw.claimNumber || ''),
    orderNumber: raw.claimNumber || raw.orderNumber || '',
    customerName: raw.customerName || raw.buyerName || '',
    customerPhone: raw.customerPhone || '',
    customerEmail: raw.customerEmail || '',
    deliveryAddress: raw.shippingAddress ? {
      fullAddress: raw.shippingAddress.fullAddress,
      city: raw.shippingAddress.city,
      district: raw.shippingAddress.district,
    } : undefined,
    totalAmount: parseFloat(raw.totalPrice) || 0,
    discountPrice: 0,
    shippingPrice: parseFloat(raw.cargoAmount) || 0,
    currency: 'TRY',
    paymentType: raw.paymentType || '',
    status: raw.status || 'pending',
    marketplaceStatus: raw.status || '',
    cargoStatus: raw.cargoStatus || '',
    cargoCompany: raw.cargoCompany || '',
    cargoTracking: raw.cargoTracking || '',
    paymentStatus: raw.paymentStatus || '',
    isPickedUp: false,
    rawPayload: raw,
    orderDate: raw.orderDate || raw.createdAt || '',
    items,
  }
}
