export interface HepsiburadaCredentials {
  apiKey: string
  apiSecret: string
  merchantId: string
}

export interface HepsiburadaProduct {
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

export interface HepsiburadaOrder {
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

export interface StockUpdate {
  barcode: string
  quantity: number
}

export interface BulkStockResponse {
  trackingId: string
  status: string
}
