import type { OrderInput, OrderItemInput } from './marketplace-order-adapter.interface'

export function yemeksepetiToCommon(raw: any, tenantId: string): OrderInput {
  const itemsArr: any[] = raw.items || []
  const items: OrderItemInput[] = itemsArr.map((l: any) => ({
    platformItemId: String(l.id || ''),
    sku: l.sku || '',
    title: l.name || '',
    quantity: l.quantity || 1,
    price: parseFloat(l.price) || 0,
    options: l.extras?.map((e: any) => ({ name: e.name || '', choice: e.choice || '' })),
  }))

  return {
    tenantId,
    platform: 'yemeksepeti',
    marketplaceOrderId: String(raw.id || ''),
    orderNumber: String(raw.id || ''),
    customerName: raw.customer?.name || raw.customerName || '',
    customerPhone: raw.customer?.phone || '',
    customerEmail: raw.customer?.email || '',
    deliveryAddress: raw.address ? {
      fullAddress: raw.address.formatted_address || raw.address.street_address,
      latitude: raw.address.latitude,
      longitude: raw.address.longitude,
    } : undefined,
    totalAmount: parseFloat(raw.payment?.order_total?.amount) || parseFloat(raw.total?.amount) || 0,
    discountPrice: parseFloat(raw.payment?.discount?.amount) || 0,
    shippingPrice: parseFloat(raw.payment?.delivery_fee?.amount) || 0,
    currency: raw.payment?.order_total?.currency || raw.total?.currency || 'TRY',
    paymentType: raw.payment?.type || raw.paymentType || '',
    status: raw.status || 'RECEIVED',
    marketplaceStatus: raw.status || '',
    paymentStatus: raw.payment?.status || '',
    isPickedUp: raw.type === 'pickup',
    rawPayload: raw,
    orderDate: raw.sys?.created_at || raw.created_at || raw.createdAt || '',
    items,
  }
}
