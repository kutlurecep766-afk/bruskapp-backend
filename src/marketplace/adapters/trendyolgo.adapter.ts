import type { OrderInput, OrderItemInput } from './marketplace-order-adapter.interface'

export function trendyolgoToCommon(raw: any, tenantId: string): OrderInput {
  const linesArr: any[] = raw.items || raw.lines || []
  const items: OrderItemInput[] = linesArr.map((l: any) => ({
    platformItemId: String(l.id || ''),
    barcode: l.barcode || l.sku || '',
    title: l.productName || l.name || l.title || '',
    quantity: l.quantity || 1,
    price: parseFloat(l.price) || parseFloat(l.unitPrice) || 0,
  }))

  return {
    tenantId,
    platform: 'trendyolgo',
    marketplaceOrderId: String(raw.id || raw.packageId || ''),
    orderNumber: raw.orderNumber || raw.id,
    customerName: raw.customer?.name || raw.customerName || '',
    customerPhone: raw.customer?.phone || '',
    customerEmail: raw.customer?.email || '',
    deliveryAddress: raw.address ? {
      fullAddress: raw.address.fullAddress,
      city: raw.address.city,
      district: raw.address.district,
      latitude: raw.address.latitude,
      longitude: raw.address.longitude,
    } : undefined,
    totalAmount: parseFloat(raw.totalPrice) || parseFloat(raw.grandTotal) || 0,
    discountPrice: parseFloat(raw.discountPrice) || 0,
    shippingPrice: parseFloat(raw.deliveryFee) || 0,
    currency: 'TRY',
    paymentType: raw.paymentType || '',
    status: raw.status || 'pending',
    marketplaceStatus: raw.status || '',
    cargoStatus: raw.deliveryStatus || '',
    cargoCompany: raw.carrier || '',
    cargoTracking: raw.trackingNumber || '',
    paymentStatus: raw.paymentStatus || '',
    isPickedUp: raw.type === 'pickup',
    rawPayload: raw,
    orderDate: raw.createdAt || raw.orderDate || '',
    items,
  }
}
