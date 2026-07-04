import { Injectable, Logger } from '@nestjs/common'
import { SendInvoiceRequest, SendInvoiceResponse } from '../types'

@Injectable()
export class QnbProvider {
  private readonly logger = new Logger(QnbProvider.name)

  async testConnection(credentials: Record<string, string>): Promise<{ success: boolean; error?: string }> {
    this.logger.log('QNB testConnection - not yet implemented')
    return { success: false, error: 'QNB eFinans entegrasyonu henüz hazır değil' }
  }

  async sendInvoice(credentials: Record<string, string>, req: SendInvoiceRequest): Promise<SendInvoiceResponse> {
    this.logger.log('QNB sendInvoice - not yet implemented')
    return { success: false, error: 'QNB eFinans entegrasyonu henüz hazır değil' }
  }
}
