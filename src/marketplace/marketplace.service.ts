import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../prisma.service'
import { N11Provider } from './providers/n11.provider'
import { TrendyolProvider } from './providers/trendyol.provider'
import { HepsiburadaProvider } from './providers/hepsiburada.provider'
import { YemeksepetiProvider } from './providers/yemeksepeti.provider'
import { TrendyolGoProvider } from './providers/trendyolgo.provider'
import type { MarketplaceProvider } from './marketplace.interface'
import type { PlatformConfig } from './types'

@Injectable()
export class MarketplaceService {
  private readonly logger = new Logger(MarketplaceService.name)
  private readonly providers = new Map<string, MarketplaceProvider>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly n11Provider: N11Provider,
    private readonly trendyolProvider: TrendyolProvider,
    private readonly hepsiburadaProvider: HepsiburadaProvider,
    private readonly yemeksepetiProvider: YemeksepetiProvider,
    private readonly trendyolGoProvider: TrendyolGoProvider,
  ) {
    this.register(n11Provider)
    this.register(trendyolProvider)
    this.register(hepsiburadaProvider)
    this.register(yemeksepetiProvider)
    this.register(trendyolGoProvider)
  }

  private register(provider: MarketplaceProvider) {
    this.providers.set(provider.platform, provider)
    this.logger.log(`Provider registered: ${provider.platform} (${provider.label})`)
  }

  getProvider(platform: string): MarketplaceProvider {
    const provider = this.providers.get(platform)
    if (!provider) throw new NotFoundException(`Pazaryeri bulunamadi: ${platform}`)
    return provider
  }

  getProviders(): MarketplaceProvider[] {
    return Array.from(this.providers.values())
  }

  getPlatformConfigs(): PlatformConfig[] {
    return [
      {
        platform: 'trendyol',
        label: 'Trendyol',
        color: 'orange',
        gradient: 'from-orange-600 to-orange-500',
        fields: [
          { key: 'apiKey', label: 'API Anahtarı (API Key)', placeholder: 'api-key' },
          { key: 'apiSecret', label: 'API Secret', placeholder: 'api-secret', type: 'password' },
          { key: 'supplierId', label: 'Satıcı ID (Supplier ID)', placeholder: '123456' },
        ],
        description: 'Trendyol satıcı panelinden (Satıcı > Entegrasyon > API) aldığınız API anahtarı, API Secret ve Satıcı ID bilgilerini girin.',
      },
      {
        platform: 'hepsiburada',
        label: 'Hepsiburada',
        color: 'purple',
        gradient: 'from-purple-600 to-purple-500',
        fields: [
          { key: 'apiKey', label: 'API Anahtarı (API Key)', placeholder: 'api-key' },
          { key: 'apiSecret', label: 'API Secret', placeholder: 'api-secret', type: 'password' },
          { key: 'merchantId', label: 'Mağaza ID (Merchant ID)', placeholder: '123456' },
        ],
        description: 'Hepsiburada satıcı panelinden aldığınız API anahtarı, API Secret ve Mağaza (Merchant) ID bilgilerini girin.',
      },
      {
        platform: 'yemeksepeti',
        label: 'Yemeksepeti',
        color: 'red',
        gradient: 'from-red-600 to-red-500',
        fields: [
          { key: 'clientId', label: 'Client ID', placeholder: 'client-id' },
          { key: 'clientSecret', label: 'Client Secret', placeholder: 'client-secret', type: 'password' },
          { key: 'chainId', label: 'Chain ID', placeholder: 'chain-id' },
          { key: 'vendorId', label: 'Vendor ID (Mağaza ID)', placeholder: 'vendor-id' },
        ],
        description: 'Yemeksepeti partner portalından (developer.yemeksepeti.com) Client ID, Client Secret, Chain ID ve Vendor ID bilgilerini girin.',
      },
      {
        platform: 'trendyolgo',
        label: 'Trendyol Go',
        color: 'emerald',
        gradient: 'from-emerald-600 to-emerald-500',
        fields: [
          { key: 'supplierId', label: 'Satıcı ID (Supplier ID)', placeholder: '123456' },
          { key: 'apiKey', label: 'API Key', placeholder: 'api-key' },
          { key: 'apiSecretKey', label: 'API Secret Key', placeholder: 'api-secret-key', type: 'password' },
          { key: 'storeId', label: 'Mağaza ID (Store ID)', placeholder: '123456' },
        ],
        description: 'Trendyol Go satıcı panelinden (Hesap Bilgilerim > Entegrasyon Bilgileri) Supplier ID, API Key, API Secret Key ve Mağaza ID bilgilerini girin.',
      },
      {
        platform: 'n11',
        label: 'n11',
        color: 'purple',
        gradient: 'from-purple-600 to-purple-500',
        fields: [
          { key: 'apiKey', label: 'API Key (AppKey)', placeholder: 'app-key' },
          { key: 'apiSecret', label: 'API Secret (AppSecret)', placeholder: 'app-secret', type: 'password' },
        ],
        description: 'n11 satıcı panelinden (so.n11.com) API Key ve API Secret bilgilerini girin.',
      },
    ]
  }

  async connect(platform: string, tenantId: string, credentials: any) {
    const provider = this.getProvider(platform)
    return provider.connect(tenantId, credentials)
  }

  async disconnect(platform: string, tenantId: string) {
    const provider = this.getProvider(platform)
    return provider.disconnect(tenantId)
  }

  async testConnection(platform: string, credentials: any) {
    const provider = this.getProvider(platform)
    return provider.testConnection(credentials)
  }

  async getConnectionStatus(platform: string, tenantId: string) {
    const provider = this.getProvider(platform)
    return provider.getConnectionStatus(tenantId)
  }

  async getProducts(platform: string, tenantId: string, page = 0, size = 100) {
    const provider = this.getProvider(platform)
    return provider.getProducts(tenantId, page, size)
  }

  async getOrders(platform: string, tenantId: string, page = 0, size = 50, status?: string) {
    const provider = this.getProvider(platform)
    return provider.getOrders(tenantId, page, size, status)
  }

  async updateStock(platform: string, tenantId: string, updates: { barcode: string; quantity: number }[]) {
    const provider = this.getProvider(platform)
    return provider.updateStock(tenantId, updates)
  }

  async getMessages(platform: string, tenantId: string) {
    const provider = this.getProvider(platform)
    if (!provider.getMessages) return []
    return provider.getMessages(tenantId)
  }

  async replyMessage(platform: string, tenantId: string, messageId: string, text: string) {
    const provider = this.getProvider(platform)
    if (!provider.replyMessage) throw new BadRequestException('Bu pazaryeri mesaj yanıtlamayı desteklemiyor')
    return provider.replyMessage(tenantId, messageId, text)
  }

  async registerWebhook(platform: string, tenantId: string, url: string) {
    const provider = this.getProvider(platform)
    if (!provider.registerWebhook) {
      return { success: false, message: 'Bu pazaryeri webhook kaydını desteklemiyor' }
    }
    return provider.registerWebhook(tenantId, url)
  }

  async handleWebhook(platform: string, tenantSlug: string, body: any) {
    const provider = this.getProvider(platform)
    if (provider.handleWebhook) {
      await provider.handleWebhook(tenantSlug, body)
    }
  }

  async getCachedOrders(platform: string, tenantId: string, page = 0, size = 50) {
    const [orders, total] = await Promise.all([
      this.prisma.marketplaceOrder.findMany({
        where: { tenantId, platform },
        orderBy: { createdAt: 'desc' },
        skip: page * size,
        take: size,
      }),
      this.prisma.marketplaceOrder.count({ where: { tenantId, platform } }),
    ])
    return { orders, total }
  }

  async pullStock(platform: string, tenantId: string) {
    const provider = this.getProvider(platform)
    const status = await provider.getConnectionStatus(tenantId)
    if (!status.connected) return { success: false, message: 'Pazaryeri bağlı değil' }

    try {
      const result = await provider.getProducts(tenantId, 0, 500)
      if (!result.products?.length) return { success: true, message: 'Pazaryerinde ürün bulunamadı', synced: 0 }

      let synced = 0
      for (const mp of result.products) {
        if (!mp.barcode) continue
        await this.prisma.marketplaceProduct.upsert({
          where: { tenantId_platform_barcode: { tenantId, platform, barcode: mp.barcode } },
          update: { stock: mp.stock, price: mp.price, title: mp.title, syncAt: new Date() },
          create: { tenantId, platform, barcode: mp.barcode, title: mp.title, price: mp.price, stock: mp.stock, currency: mp.currency, description: mp.description, images: mp.images || [], category: mp.category, brand: mp.brand, marketplaceId: mp.marketplaceId },
        })
        synced++
      }

      return { success: true, message: `${synced} ürün senkronize edildi`, synced }
    } catch (e: any) {
      return { success: false, message: `Stok çekme hatasi: ${e.message}` }
    }
  }

  async checkBulkStockStatus(platform: string, tenantId: string, trackingId: string) {
    const provider = this.getProvider(platform)
    if (!provider.checkBulkStockStatus) {
      throw new BadRequestException('Bu pazaryeri toplu stok takibini desteklemiyor')
    }
    return provider.checkBulkStockStatus(tenantId, trackingId)
  }
}
