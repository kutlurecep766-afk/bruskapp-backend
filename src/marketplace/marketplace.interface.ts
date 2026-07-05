export interface MarketplaceCredentials {
  [key: string]: any
}

export interface MarketplaceProduct {
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

export interface MarketplaceOrderItem {
  barcode: string
  title: string
  quantity: number
  price: number
}

export interface MarketplaceOrder {
  id: string
  orderNumber: string
  customerName: string
  customerEmail?: string
  customerPhone?: string
  products: MarketplaceOrderItem[]
  totalAmount: number
  currency: string
  status: string
  cargoStatus?: string
  cargoCompany?: string
  cargoTracking?: string
  paymentStatus?: string
  orderDate: string
}

export interface MarketplaceMessage {
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

export interface ConnectResult {
  success: boolean
  message: string
}

export interface TestResult {
  success: boolean
  message: string
}

export interface StatusResult {
  connected: boolean
  [key: string]: any
}

export interface ProductsResult {
  products: MarketplaceProduct[]
  total: number
  page: number
}

export interface OrdersResult {
  orders: MarketplaceOrder[]
  total: number
  page: number
}

export interface MarketplaceProvider {
  readonly platform: string
  readonly label: string
  readonly color: string

  connect(tenantId: string, credentials: MarketplaceCredentials): Promise<ConnectResult>
  disconnect(tenantId: string): Promise<ConnectResult>
  testConnection(credentials: MarketplaceCredentials): Promise<TestResult>
  getConnectionStatus(tenantId: string): Promise<StatusResult>
  getProducts(tenantId: string, page?: number, size?: number): Promise<ProductsResult>
  getOrders(tenantId: string, page?: number, size?: number, status?: string): Promise<OrdersResult>
  updateStock(tenantId: string, updates: StockUpdate[]): Promise<ConnectResult>
  getMessages?(tenantId: string): Promise<MarketplaceMessage[]>
  replyMessage?(tenantId: string, messageId: string, text: string): Promise<ConnectResult>
  registerWebhook?(tenantId: string, url: string): Promise<ConnectResult>
  handleWebhook?(tenantSlug: string, body: any): Promise<void>
  syncOrders?(tenantId: string): Promise<void>
}
