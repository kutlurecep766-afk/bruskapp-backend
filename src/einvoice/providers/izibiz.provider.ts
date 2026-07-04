import { Injectable, Logger } from '@nestjs/common'
import { SendInvoiceRequest, SendInvoiceResponse } from '../types'

@Injectable()
export class IzibizProvider {
  private readonly logger = new Logger(IzibizProvider.name)

  async testConnection(credentials: Record<string, string>): Promise<{ success: boolean; error?: string }> {
    this.logger.log('Izibiz testConnection - not yet implemented')
    return { success: false, error: 'İzibiz entegrasyonu henüz hazır değil' }
  }

  async sendInvoice(credentials: Record<string, string>, req: SendInvoiceRequest): Promise<SendInvoiceResponse> {
    this.logger.log('Izibiz sendInvoice - not yet implemented')
    return { success: false, error: 'İzibiz entegrasyonu henüz hazır değil' }
  }
}
