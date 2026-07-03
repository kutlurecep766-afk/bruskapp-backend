export interface TrendyolCredentials {
  apiKey: string
  apiSecret: string
  supplierId: string
}

export interface TrendyolProduct {
  barcode: string
  title: string
  price: number
  stock: number
  currency: string
  description?: string
  images?: string[]
  category?: string
  brand?: string
  marketplaceId?: string
}

export interface TrendyolOrder {
  id: string
  orderNumber: string
  customerName: string
  customerEmail?: string
  customerPhone?: string
  products: { barcode: string; title: string; quantity: number; price: number }[]
  totalAmount: number
  currency: string
  status: string
  cargoStatus?: string
  cargoCompany?: string
  cargoTracking?: string
  paymentStatus?: string
  orderDate: string
}

export interface TrendyolMessage {
  id: string
  from: string
  subject: string
  body: string
  createdAt: string
  read: boolean
}

export interface StockUpdate {
  barcode: string
  quantity: number
}