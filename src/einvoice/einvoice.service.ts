import { Injectable, Logger, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../prisma.service'
import { NilveraProvider } from './providers/nilvera.provider'
import { IzibizProvider } from './providers/izibiz.provider'
import { EdmProvider } from './providers/edm.provider'
import { QnbProvider } from './providers/qnb.provider'
import { EInvoiceProvider, SendInvoiceRequest } from './types'

@Injectable()
export class EInvoiceService {
  private readonly logger = new Logger(EInvoiceService.name)

  constructor(
    private prisma: PrismaService,
    private nilvera: NilveraProvider,
    private izibiz: IzibizProvider,
    private edm: EdmProvider,
    private qnb: QnbProvider,
  ) {}

  async getConfig(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { einvoiceConfig: true },
    })
    return (tenant?.einvoiceConfig as any) || {}
  }

  async saveConfig(tenantId: string, config: any) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } })
    const current = (tenant?.einvoiceConfig as any) || {}
    const merged = { ...current, ...config }
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { einvoiceConfig: merged },
    })
    return merged
  }

  async testConnection(provider: string, credentials?: Record<string, string>) {
    if (!credentials) {
      return { success: false, error: 'Lütfen bağlantı bilgilerini girin' }
    }
    if (!credentials.username && !credentials.apiKey) {
      return { success: false, error: 'Kullanıcı adı veya API anahtarı gerekli' }
    }
    const prov = this.getProvider(provider as EInvoiceProvider)
    return prov.testConnection(credentials)
  }

  async sendInvoice(tenantId: string, req: SendInvoiceRequest) {
    const config = await this.getConfig(tenantId)
    const provider = config.selectedProvider || EInvoiceProvider.NILVERA
    const providerConfig = config[provider]
    if (!providerConfig?.credentials) {
      throw new BadRequestException('Lutfen fatura entegratoru ayarlarini yapin')
    }
    const prov = this.getProvider(provider as EInvoiceProvider)
    const result = await prov.sendInvoice(providerConfig.credentials, req)
    this.logger.log(`Fatura gonderildi: ${provider} - ${result.invoiceNumber || result.uuid}`)
    return result
  }

  async fetchTemplates(tenantId: string, provider: string) {
    const config = await this.getConfig(tenantId)
    const providerConfig = config[provider]
    if (!providerConfig?.credentials) {
      throw new BadRequestException(`Bu saglayici icin ayar bulunamadi: ${provider}`)
    }
    const prov = this.getProvider(provider as EInvoiceProvider)
    if (typeof (prov as any).fetchTemplates === 'function') {
      return (prov as any).fetchTemplates(providerConfig.credentials)
    }
    return { success: false, error: 'Bu saglayici sablon listeleme desteklemiyor' }
  }

  private getProvider(provider: EInvoiceProvider) {
    switch (provider) {
      case EInvoiceProvider.NILVERA: return this.nilvera
      case EInvoiceProvider.IZIBIZ: return this.izibiz
      case EInvoiceProvider.EDM: return this.edm
      case EInvoiceProvider.QNB: return this.qnb
      default: throw new BadRequestException(`Desteklenmeyen entegrator: ${provider}`)
    }
  }
}
