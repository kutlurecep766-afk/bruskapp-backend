import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Job } from 'bullmq'
import { Logger } from '@nestjs/common'
import { EInvoiceService } from '../einvoice/einvoice.service'
import { NotificationsService } from '../notifications/notifications.service'

@Processor('order-processing')
export class OrderProcessingProcessor extends WorkerHost {
  private readonly logger = new Logger(OrderProcessingProcessor.name)

  constructor(
    private einvoiceService: EInvoiceService,
    private notificationsService: NotificationsService,
  ) {
    super()
  }

  async process(job: Job<{
    tenantId: string
    platform: string
    customerName: string
    totalAmount: number
    currency: string
    products: any[]
    note?: string
    customerVkn?: string
    customerTckn?: string
    customerEmail?: string
    customerPhone?: string
    customerAddress?: string
    customerTaxOffice?: string
  }>): Promise<void> {
    const data = job.data

    switch (job.name) {
      case 'send-invoice':
        const vkn = data.customerVkn || data.customerTckn
        if (vkn && data.products?.length) {
          await this.einvoiceService.sendInvoice(data.tenantId, {
            type: undefined as any,
            customer: {
              name: data.customerName,
              vkn: data.customerVkn,
              tckn: data.customerTckn,
              email: data.customerEmail,
              phone: data.customerPhone,
              address: data.customerAddress,
              taxOffice: data.customerTaxOffice,
            },
            lines: data.products.map((p: any) => ({
              name: p.name || p.title || 'Urun',
              quantity: p.quantity || 1,
              unitPrice: p.price || p.unitPrice || 0,
              vatRate: p.vatRate ?? 20,
            })),
            description: data.note || 'Siparis ' + data.platform,
          }).then(r => {
            if (r.success) this.logger.log('Fatura otomatik kesildi: ' + r.invoiceNumber)
          }).catch(e => this.logger.warn('Fatura hatasi: ' + e.message))
        }
        break

      case 'send-notification':
        await this.notificationsService.createNotification(
          data.platform,
          'Yeni Siparis',
          data.platform + ' uzerinden ' + data.customerName + ' tarafindan ' + data.totalAmount + ' ' + (data.currency || 'TRY') + ' tutarinda siparis verildi'
        ).catch(e => this.logger.warn('Bildirim hatasi: ' + e.message))
        break
    }
  }
}
