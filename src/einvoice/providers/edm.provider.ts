import { Injectable, Logger } from '@nestjs/common'
import { SendInvoiceRequest, SendInvoiceResponse } from '../types'

@Injectable()
export class EdmProvider {
  private readonly logger = new Logger(EdmProvider.name)

  async testConnection(credentials: Record<string, string>): Promise<{ success: boolean; error?: string }> {
    this.logger.log('EDM testConnection - not yet implemented')
    return { success: false, error: 'EDM entegrasyonu henüz hazır değil' }
  }

  async sendInvoice(credentials: Record<string, string>, req: SendInvoiceRequest): Promise<SendInvoiceResponse> {
    this.logger.log('EDM sendInvoice - not yet implemented')
    return { success: false, error: 'EDM entegrasyonu henüz hazır değil' }
  }
}
