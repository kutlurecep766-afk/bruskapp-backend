import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma.service'

const TABLE_PAYMENTS: string[] = ['Online Ödeme', 'Kasada Kart', 'Kasada Nakit']
const ONLINE_PAYMENTS: string[] = ['Online Ödeme', 'Kapıda Kart', 'Kapıda Nakit']

const DEFAULT_STORE_SETTINGS = { status: 'open', autoMode: false, openTime: '09:00', closeTime: '23:00' }

function timeToMins(t: string | undefined): number | null {
  if (!t) return null
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim())
  if (!m) return null
  return parseInt(m[1]) * 60 + parseInt(m[2])
}

export type StoreScope = 'table' | 'online'

export function splitStoreSettings(settings: any = {}): { table: any; online: any } {
  const legacy = { ...DEFAULT_STORE_SETTINGS, ...(settings || {}) }
  if (settings && (settings.table || settings.online)) {
    return {
      table: { ...DEFAULT_STORE_SETTINGS, ...(settings.table || {}) },
      online: { ...DEFAULT_STORE_SETTINGS, ...(settings.online || {}) },
    }
  }
  return { table: { ...legacy }, online: { ...legacy } }
}

function computeStatus(s: any, now: Date): 'open' | 'busy' | 'closed' {
  if (s.autoMode) {
    const open = timeToMins(s.openTime)
    const close = timeToMins(s.closeTime)
    if (open !== null && close !== null) {
      const cur = now.getHours() * 60 + now.getMinutes()
      let inHours
      if (open === close) inHours = true
      else if (open < close) inHours = cur >= open && cur < close
      else inHours = cur >= open || cur < close
      return inHours ? 'open' : 'closed'
    }
  }
  return s.status === 'busy' || s.status === 'closed' ? s.status : 'open'
}

export function effectiveStoreStatus(settings: any = {}, now = new Date(), scope?: StoreScope): 'open' | 'busy' | 'closed' {
  const scoped = splitStoreSettings(settings)
  return computeStatus(scope === 'table' ? scoped.table : scoped.online, now)
}

export function parseStoreConfig(raw: any): any {
  return typeof raw === 'string' ? JSON.parse(raw) : (raw || {})
}

@Injectable()
export class StorefrontService {
  constructor(private prisma: PrismaService) {}

  async getMenu(slug: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { slug } })
    if (!tenant) throw new NotFoundException('Isletme bulunamadi')
    const cfg = parseStoreConfig(tenant.storefrontConfig)
    const apiKeys = (tenant?.apiKeys as any) || {}
    const posConfigured = !!(apiKeys.paytr?.merchantId || apiKeys.iyzico?.apiKey || apiKeys.sipay?.clientCode || apiKeys.odeal?.appId)
    const savedTable = Array.isArray(cfg.paymentMethodsTable) ? cfg.paymentMethodsTable.filter((m: string) => TABLE_PAYMENTS.includes(m)) : []
    const savedOnline = Array.isArray(cfg.paymentMethodsOnline) ? cfg.paymentMethodsOnline.filter((m: string) => ONLINE_PAYMENTS.includes(m)) : []
    const scoped = splitStoreSettings(cfg.storeSettings)
    return {
      id: tenant.id,
      name: tenant.siteTitle || tenant.name,
      logoUrl: tenant.logoUrl,
      primaryColor: tenant.primaryColor,
      secondaryColor: tenant.secondaryColor,
      bannerUrl: cfg.bannerUrl || '',
      products: cfg.products || [],
      masaNumbers: cfg.masaNumbers || [],
      googleReviewUrl: cfg.googleReviewUrl || '',
      instagramUrl: cfg.instagramUrl || '',
      shopName: cfg.shopName || '',
      address: cfg.address || '',
      phone: cfg.phone || '',
      locationUrl: cfg.locationUrl || '',
      workingHours: cfg.workingHours || [],
      paymentMethodsTable: savedTable.length ? savedTable : TABLE_PAYMENTS,
      paymentMethodsOnline: savedOnline.length ? savedOnline : ONLINE_PAYMENTS,
      posConfigured,
      storeStatus: computeStatus(scoped.online, new Date()),
      storeStatusTable: computeStatus(scoped.table, new Date()),
      storeSettings: scoped,
    }
  }

  async getStoreSettings(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { storefrontConfig: true } })
    if (!tenant) throw new NotFoundException('Isletme bulunamadi')
    const cfg = parseStoreConfig(tenant.storefrontConfig)
    const scoped = splitStoreSettings(cfg.storeSettings)
    const now = new Date()
    return {
      table: { settings: scoped.table, effectiveStatus: computeStatus(scoped.table, now) },
      online: { settings: scoped.online, effectiveStatus: computeStatus(scoped.online, now) },
    }
  }

  async updateStoreSettings(tenantId: string, dto: { table?: any; online?: any }) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { storefrontConfig: true } })
    if (!tenant) throw new NotFoundException('Isletme bulunamadi')
    const cfg = parseStoreConfig(tenant.storefrontConfig)
    const scoped = splitStoreSettings(cfg.storeSettings)
    const pick = (input: any, fallback: any) => ({
      status: ['open', 'busy', 'closed'].includes(input?.status || '') ? input.status : fallback.status,
      autoMode: typeof input?.autoMode === 'boolean' ? input.autoMode : fallback.autoMode,
      openTime: /^\d{1,2}:\d{2}$/.test(input?.openTime || '') ? input.openTime : fallback.openTime,
      closeTime: /^\d{1,2}:\d{2}$/.test(input?.closeTime || '') ? input.closeTime : fallback.closeTime,
    })
    const table = pick(dto?.table, scoped.table)
    const online = pick(dto?.online, scoped.online)
    const next = { table, online }
    await this.prisma.tenant.update({ where: { id: tenantId }, data: { storefrontConfig: { ...cfg, storeSettings: next } } })
    const now = new Date()
    return {
      table: { settings: table, effectiveStatus: computeStatus(table, now) },
      online: { settings: online, effectiveStatus: computeStatus(online, now) },
    }
  }

  async getProducts(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { storefrontConfig: true } })
    if (!tenant) throw new NotFoundException('Isletme bulunamadi')
    const cfg = typeof tenant.storefrontConfig === 'string' ? JSON.parse(tenant.storefrontConfig) : (tenant.storefrontConfig || {})
    return cfg.products || []
  }

  async addProduct(tenantId: string, product: { name: string; price: number; description?: string; image?: string; category?: string; weight?: string; originalPrice?: number; status?: string }) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { storefrontConfig: true } })
    if (!tenant) throw new NotFoundException('Isletme bulunamadi')
    const cfg = typeof tenant.storefrontConfig === 'string' ? JSON.parse(tenant.storefrontConfig) : (tenant.storefrontConfig || {})
    const products = cfg.products || []
    const newProduct = { ...product, id: crypto.randomUUID(), price: Number(product.price), status: product.status || 'active' }
    products.push(newProduct)
    await this.prisma.tenant.update({ where: { id: tenantId }, data: { storefrontConfig: { ...cfg, products } } })
    return newProduct
  }

  async updateProduct(tenantId: string, productId: string, data: Partial<{ name: string; price: number; description: string; image: string; category: string; weight: string; originalPrice: number; status: string }>) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { storefrontConfig: true } })
    if (!tenant) throw new NotFoundException('Isletme bulunamadi')
    const cfg = typeof tenant.storefrontConfig === 'string' ? JSON.parse(tenant.storefrontConfig) : (tenant.storefrontConfig || {})
    const products = (cfg.products || []).map((p: any) => p.id === productId ? { ...p, ...data, price: data.price !== undefined ? Number(data.price) : p.price, status: data.status || p.status || 'active' } : p)
    await this.prisma.tenant.update({ where: { id: tenantId }, data: { storefrontConfig: { ...cfg, products } } })
    return products.find((p: any) => p.id === productId)
  }

  async deleteProduct(tenantId: string, productId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { storefrontConfig: true } })
    if (!tenant) throw new NotFoundException('Isletme bulunamadi')
    const cfg = typeof tenant.storefrontConfig === 'string' ? JSON.parse(tenant.storefrontConfig) : (tenant.storefrontConfig || {})
    const products = (cfg.products || []).filter((p: any) => p.id !== productId)
    await this.prisma.tenant.update({ where: { id: tenantId }, data: { storefrontConfig: { ...cfg, products } } })
  }

  async updateConfig(tenantId: string, config: { masaNumbers?: number[]; bannerUrl?: string; googleReviewUrl?: string; instagramUrl?: string; shopName?: string; address?: string; phone?: string; locationUrl?: string; workingHours?: string[]; paymentMethodsTable?: string[]; paymentMethodsOnline?: string[] }) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { storefrontConfig: true } })
    if (!tenant) throw new NotFoundException('Isletme bulunamadi')
    const cfg = typeof tenant.storefrontConfig === 'string' ? JSON.parse(tenant.storefrontConfig) : (tenant.storefrontConfig || {})
    await this.prisma.tenant.update({ where: { id: tenantId }, data: { storefrontConfig: { ...cfg, ...config } } })
  }

  async updateLogo(tenantId: string, logoUrl: string) {
    await this.prisma.tenant.update({ where: { id: tenantId }, data: { logoUrl } })
  }

  async getStorefront(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } })
    if (!tenant) throw new NotFoundException('Isletme bulunamadi')
    const cfg = typeof tenant.storefrontConfig === 'string' ? JSON.parse(tenant.storefrontConfig) : (tenant.storefrontConfig || {})
    const savedTable = Array.isArray(cfg.paymentMethodsTable) ? cfg.paymentMethodsTable.filter((m: string) => TABLE_PAYMENTS.includes(m)) : []
    const savedOnline = Array.isArray(cfg.paymentMethodsOnline) ? cfg.paymentMethodsOnline.filter((m: string) => ONLINE_PAYMENTS.includes(m)) : []
    return {
      id: tenant.id,
      name: tenant.siteTitle || tenant.name,
      slug: tenant.slug,
      logoUrl: tenant.logoUrl,
      primaryColor: tenant.primaryColor,
      secondaryColor: tenant.secondaryColor,
      bannerUrl: cfg.bannerUrl || '',
      products: cfg.products || [],
      masaNumbers: cfg.masaNumbers || [],
      googleReviewUrl: cfg.googleReviewUrl || '',
      instagramUrl: cfg.instagramUrl || '',
      shopName: cfg.shopName || '',
      address: cfg.address || '',
      phone: cfg.phone || '',
      locationUrl: cfg.locationUrl || '',
      workingHours: cfg.workingHours || [],
      paymentMethodsTable: savedTable.length ? savedTable : TABLE_PAYMENTS,
      paymentMethodsOnline: savedOnline.length ? savedOnline : ONLINE_PAYMENTS,
    }
  }
}
