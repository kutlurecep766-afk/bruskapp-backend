export interface OrderItemInput {
  platformItemId?: string
  sku?: string
  barcode?: string
  title: string
  quantity: number
  price: number
  options?: Record<string, any>[]
}

export interface OrderInput {
  tenantId: string
  platform: string
  marketplaceOrderId: string
  orderNumber?: string
  customerName: string
  customerPhone?: string
  customerEmail?: string
  deliveryAddress?: Record<string, any>
  totalAmount: number
  discountPrice?: number
  shippingPrice?: number
  currency?: string
  paymentType?: string
  status: string
  marketplaceStatus?: string
  cargoStatus?: string
  cargoCompany?: string
  cargoTracking?: string
  paymentStatus?: string
  isPickedUp?: boolean
  note?: string
  rawPayload?: Record<string, any>
  orderDate?: string
  items: OrderItemInput[]
}

export interface IMarketplaceOrderAdapter {
  platform: string
  toCommonOrder(rawPayload: any, tenantId: string): OrderInput
}
