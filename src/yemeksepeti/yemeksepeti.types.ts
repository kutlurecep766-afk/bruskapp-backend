export interface YemeksepetiConfig {
  clientId: string
  clientSecret: string
  chainId: string
  vendorId: string
}

export interface YemeksepetiTokenResponse {
  access_token: string
  expires_in: number
  token_type: string
}

export interface YemeksepetiOrder {
  id: string
  orderNumber: string
  status: string
  totalAmount: number
  currency: string
  customerName: string
  customerPhone: string
  customerAddress: string
  products: { name: string; quantity: number; price: number }[]
  createdAt: string
  note?: string
}
