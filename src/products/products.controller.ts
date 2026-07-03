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
    return this.productsService.update(parseInt(id), body)
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
