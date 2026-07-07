import type { OrderInput, OrderItemInput } from './marketplace-order-adapter.interface'

export function trendyolToCommon(raw: any, tenantId: string): OrderInput {
  const lines: any[] = raw.lines || []
  const items: OrderItemInput[] = lines.map((l: any) => ({
    platformItemId: String(l.id || ''),
    barcode: l.barcode || '',
    title: l.productName || l.title || '',
    quantity: l.quantity || 1,
    price: parseFloat(l.price) || 0,
  }))

  return {
    tenantId,
    platform: 'trendyol',
    marketplaceOrderId: String(raw.id || ''),
    orderNumber: raw.orderNumber || '',
    customerName: raw.customerName || '',
    customerPhone: raw.customerPhone || '',
    customerEmail: raw.customerEmail || '',
    deliveryAddress: raw.address ? {
      fullAddress: raw.address.fullAddress,
      city: raw.address.city,
      district: raw.address.district,
      neighborhood: raw.address.neighborhood,
    } : undefined,
    totalAmount: parseFloat(raw.totalPrice) || 0,
    discountPrice: parseFloat(raw.discountPrice) || 0,
    shippingPrice: parseFloat(raw.cargoAmount) || 0,
    currency: raw.currencyType || 'TRY',
    paymentType: raw.paymentType || '',
    status: raw.status || 'pending',
    marketplaceStatus: raw.status || '',
    cargoStatus: raw.cargoStatus || '',
    cargoCompany: raw.cargoProviderName || '',
    cargoTracking: raw.cargoTrackingNumber || '',
    paymentStatus: raw.paymentStatus || '',
    isPickedUp: false,
    rawPayload: raw,
    orderDate: raw.orderDate || raw.createdAt || '',
    items,
  }
}
