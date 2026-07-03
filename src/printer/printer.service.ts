import { Injectable, Logger } from '@nestjs/common'
import { Subject } from 'rxjs'
import { PrismaService } from '../prisma.service'

export interface PrintJob {
  tenantSlug: string
  tableNumber?: number | null
  customerName: string
  products: { name: string; quantity: number; price: number }[]
  totalAmount: number
  type: 'order' | 'bill'
}

@Injectable()
export class PrinterService {
  private readonly logger = new Logger(PrinterService.name)
  public printJobs = new Subject<PrintJob>()

  constructor(private prisma: PrismaService) {}

  async print(job: PrintJob) {
    this.printJobs.next(job)
    this.logger.log(`Yaziciya gonderildi: ${job.tenantSlug} - ${job.totalAmount}TL`)
    return { queued: true }
  }

  async getConfig(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { printerConfig: true },
    })
    return (tenant?.printerConfig as any) || {}
  }

  async saveConfig(tenantId: string, config: any) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } })
    const current = (tenant?.printerConfig as any) || {}
    const merged = { ...current, ...config }
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { printerConfig: merged },
    })
    return merged
  }
}
