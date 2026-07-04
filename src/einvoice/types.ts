export enum EInvoiceProvider {
  NILVERA = 'nilvera',
  IZIBIZ = 'izibiz',
  EDM = 'edm',
  QNB = 'qnb',
}

export type InvoiceType = 'invoice' | 'archive'

export interface EInvoiceConfig {
  provider: EInvoiceProvider
  credentials: Record<string, string>
}

export interface EInvoiceLine {
  name: string
  quantity: number
  unitPrice: number
  vatRate?: number
}

export interface CustomerInfo {
  name: string
  surname?: string
  vkn?: string
  tckn?: string
  email?: string
  phone?: string
  address?: string
  taxOffice?: string
}

export interface SendInvoiceRequest {
  type: InvoiceType
  customer: CustomerInfo
  lines: EInvoiceLine[]
  issueDate?: string
  description?: string
  salesPlatform?: 'NORMAL' | 'INTERNET'
  sendType?: 'KAGIT' | 'ELEKTRONIK'
  profileId?: 'TICARIFATURA' | 'TEMELFATURA' | 'EARSIVFATURA'
}

export interface SendInvoiceResponse {
  success: boolean
  invoiceNumber?: string
  ettin?: string
  uuid?: string
  status?: string
  error?: string
}

export interface EInvoiceProviderInterface {
  testConnection(config: Record<string, string>): Promise<{ success: boolean; error?: string }>
  sendInvoice(config: Record<string, string>, req: SendInvoiceRequest): Promise<SendInvoiceResponse>
  getInvoiceStatus?(config: Record<string, string>, uuid: string): Promise<SendInvoiceResponse>
  checkUser?(config: Record<string, string>, taxNumber: string): Promise<{ registered: boolean; error?: string }>
}
