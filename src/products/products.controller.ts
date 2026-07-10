import { Controller, Get, Post, Patch, Delete, Param, Body, Req, ForbiddenException, NotFoundException } from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'
import { Public } from '../auth/public.decorator'
import { ProductsService } from './products.service'

@SkipThrottle()
@Controller('products')
export class ProductsController {
  constructor(private productsService: ProductsService) {}

  @Post()
  async create(@Req() req: any, @Body() body: {
    name: string
    description?: string
    barcode?: string
    price: number
    images?: string[]
    category?: string
    stock?: number
    active?: boolean
  }) {
    const tenantId = req.user?.tenantId
    if (!tenantId) throw new ForbiddenException('İşletme bulunamadı')
    return this.productsService.create({ ...body, tenantId })
  }

  @Get()
  async findAll(@Req() req: any) {
    const tenantId = req.user?.tenantId
    if (!tenantId) throw new ForbiddenException('İşletme bulunamadı')
    return this.productsService.findAll(tenantId)
  }

  @Get(':id')
  async findById(@Req() req: any, @Param('id') id: string) {
    const product = await this.productsService.findById(parseInt(id))
    if (!product) throw new NotFoundException('Ürün bulunamadı')
    if (product.tenantId !== req.user?.tenantId && req.user?.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Yetkiniz yok')
    }
    return product
  }

  @Patch(':id')
  async update(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const product = await this.productsService.findById(parseInt(id))
    if (!product) throw new NotFoundException('Ürün bulunamadı')
    if (product.tenantId !== req.user?.tenantId) throw new ForbiddenException('Yetkiniz yok')
    const result = this.productsService.update(parseInt(id), body)
    if (body.stock !== undefined || body.price !== undefined) {
      this.productsService.syncToMarketplaces(product.tenantId, [parseInt(id)])
        .catch(e => console.error('Sync hatasi:', e))
    }
    return result
  }

  @Post('sync')
  async syncToMarketplaces(@Req() req: any, @Body() body: { productIds: number[] }) {
    const tenantId = req.user?.tenantId
    if (!tenantId) throw new ForbiddenException('İşletme bulunamadı')
    return this.productsService.syncToMarketplaces(tenantId, body.productIds)
  }

  @Get('by-barcode/:barcode')
  async findByBarcode(@Req() req: any, @Param('barcode') barcode: string) {
    const tenantId = req.user?.tenantId
    if (!tenantId) throw new ForbiddenException('İşletme bulunamadı')
    const product = await this.productsService.findByBarcode(tenantId, barcode)
    return { found: !!product, product }
  }

  @Post('qr-stock')
  async qrStock(@Req() req: any, @Body() body: { barcode: string; quantity: number; type: 'ADD' | 'DEDUCT'; note?: string }) {
    const tenantId = req.user?.tenantId
    if (!tenantId) throw new ForbiddenException('İşletme bulunamadı')
    const product = await this.productsService.findByBarcode(tenantId, body.barcode)
    if (!product) throw new NotFoundException('Barkod eşleşen ürün bulunamadı')
    const qty = body.type === 'DEDUCT' ? -Math.abs(body.quantity) : Math.abs(body.quantity)
    return this.productsService.addStockMovement(tenantId, product.id, 'MANUAL', qty, body.note, req.user?.id)
  }

  @Post('manual-stock')
  async manualStock(@Req() req: any, @Body() body: { productId: number; quantity: number; type: 'ADD' | 'DEDUCT'; note?: string }) {
    const tenantId = req.user?.tenantId
    if (!tenantId) throw new ForbiddenException('İşletme bulunamadı')
    const product = await this.productsService.findById(body.productId)
    if (!product || product.tenantId !== tenantId) throw new NotFoundException('Ürün bulunamadı')
    const qty = body.type === 'DEDUCT' ? -Math.abs(body.quantity) : Math.abs(body.quantity)
    return this.productsService.addStockMovement(tenantId, product.id, 'MANUAL', qty, body.note, req.user?.id)
  }

  // Variants
  @Post(':id/variants')
  async createVariant(@Req() req: any, @Param('id') id: string, @Body() body: {
    name: string; barcode?: string; price?: number; stock?: number; options?: string[]; images?: string[]
  }) {
    const tenantId = req.user?.tenantId
    if (!tenantId) throw new ForbiddenException('İşletme bulunamadı')
    const product = await this.productsService.findById(parseInt(id))
    if (!product || product.tenantId !== tenantId) throw new ForbiddenException('Yetkiniz yok')
    return this.productsService.createVariant(parseInt(id), body)
  }

  @Get(':id/variants')
  async getVariants(@Req() req: any, @Param('id') id: string) {
    const tenantId = req.user?.tenantId
    if (!tenantId) throw new ForbiddenException('İşletme bulunamadı')
    const product = await this.productsService.findById(parseInt(id))
    if (!product || product.tenantId !== tenantId) throw new ForbiddenException('Yetkiniz yok')
    return this.productsService.getVariants(parseInt(id))
  }

  @Patch('variants/:variantId')
  async updateVariant(@Req() req: any, @Param('variantId') variantId: string, @Body() body: any) {
    const tenantId = req.user?.tenantId
    if (!tenantId) throw new ForbiddenException('İşletme bulunamadı')
    return this.productsService.updateVariant(parseInt(variantId), body)
  }

  @Delete('variants/:variantId')
  async deleteVariant(@Req() req: any, @Param('variantId') variantId: string) {
    const tenantId = req.user?.tenantId
    if (!tenantId) throw new ForbiddenException('İşletme bulunamadı')
    return this.productsService.deleteVariant(parseInt(variantId))
  }

  @Delete(':id')
  async remove(@Req() req: any, @Param('id') id: string) {
    const product = await this.productsService.findById(parseInt(id))
    if (!product) throw new NotFoundException('Ürün bulunamadı')
    if (product.tenantId !== req.user?.tenantId) throw new ForbiddenException('Yetkiniz yok')
    return this.productsService.remove(parseInt(id))
  }

  @Public()
  @Get('storefront/:slug')
  async getStorefront(@Param('slug') slug: string) {
    const products = await this.productsService.findByTenantSlug(slug)
    if (products === null) throw new NotFoundException('İşletme bulunamadı')
    const tenant = await this.productsService['prisma'].tenant.findUnique({ where: { slug } })
    return {
      tenant: { name: tenant?.name, slug: tenant?.slug, logoUrl: tenant?.logoUrl, primaryColor: tenant?.primaryColor, siteTitle: tenant?.siteTitle, secondaryColor: tenant?.secondaryColor, storefrontConfig: tenant?.storefrontConfig },
      products,
    }
  }
}
