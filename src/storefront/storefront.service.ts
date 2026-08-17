import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma.service'

@Injectable()
export class StorefrontService {
  constructor(private prisma: PrismaService) {}

  async getMenu(slug: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { slug } })
    if (!tenant) throw new NotFoundException('Isletme bulunamadi')
    const cfg = typeof tenant.storefrontConfig === 'string' ? JSON.parse(tenant.storefrontConfig) : (tenant.storefrontConfig || {})
    const apiKeys = (tenant?.apiKeys as any) || {}
    const posConfigured = !!(apiKeys.paytr?.merchantId || apiKeys.iyzico?.apiKey || apiKeys.sipay?.clientCode || apiKeys.odeal?.appId)
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
      paymentMethodsTable: cfg.paymentMethodsTable || (cfg.paymentMethods?.length ? cfg.paymentMethods : ['Kasada Nakit', 'Kasada Kart', 'Online Ödeme']),
      paymentMethodsOnline: cfg.paymentMethodsOnline || (cfg.paymentMethods?.length ? cfg.paymentMethods : ['Kapıda Nakit', 'Kapıda Kart', 'Online Ödeme']),
      paymentMethods: cfg.paymentMethods || [],
      posConfigured,
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

  async updateConfig(tenantId: string, config: { masaNumbers?: number[]; bannerUrl?: string; googleReviewUrl?: string; instagramUrl?: string; shopName?: string; address?: string; phone?: string; locationUrl?: string; workingHours?: string[]; paymentMethods?: string[]; paymentMethodsTable?: string[]; paymentMethodsOnline?: string[] }) {
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
      paymentMethodsTable: cfg.paymentMethodsTable || (cfg.paymentMethods?.length ? cfg.paymentMethods : ['Kasada Nakit', 'Kasada Kart', 'Online Ödeme']),
      paymentMethodsOnline: cfg.paymentMethodsOnline || (cfg.paymentMethods?.length ? cfg.paymentMethods : ['Kapıda Nakit', 'Kapıda Kart', 'Online Ödeme']),
      paymentMethods: cfg.paymentMethods || [],
    }
  }
}
