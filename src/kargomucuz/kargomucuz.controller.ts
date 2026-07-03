import { Controller, Post, Get, Delete, Body, Param, Query, Req } from '@nestjs/common'
import { KargomucuzService } from './kargomucuz.service'

@Controller('kargomucuz')
export class KargomucuzController {
  constructor(private readonly kargo: KargomucuzService) {}

  @Post('connect')
  async connect(@Body() dto: { email: string; password: string }, @Req() req: any) {
    return this.kargo.saveCredentials(req.user.tenantId, dto)
  }

  @Get('status')
  async status(@Req() req: any) {
    return this.kargo.testConnection(req.user.tenantId)
  }

  @Get('providers')
  async getProviders(@Req() req: any, @Query('type') type?: string) {
    return this.kargo.getProviders(req.user.tenantId, type)
  }

  @Post('address')
  async createAddress(@Body() dto: any, @Req() req: any) {
    return this.kargo.createAddress(req.user.tenantId, dto)
  }

  @Get('addresses')
  async getAddresses(@Req() req: any, @Query('type') type?: string) {
    return this.kargo.getAddresses(req.user.tenantId, type)
  }

  @Post('shipment')
  async createShipment(@Body() dto: any, @Req() req: any) {
    return this.kargo.createShipment(req.user.tenantId, dto)
  }

  @Get('shipments')
  async listShipments(@Req() req: any) {
    return this.kargo.listShipments(req.user.tenantId)
  }

  @Get('track/:trackingId')
  async trackShipment(@Param('trackingId') trackingId: string, @Req() req: any) {
    return this.kargo.trackShipment(req.user.tenantId, trackingId)
  }

  @Delete('shipment/:id')
  async cancelShipment(@Param('id') id: string, @Req() req: any) {
    return this.kargo.cancelShipment(req.user.tenantId, id)
  }

  @Get('price')
  async calculatePrice(@Query('provider') provider: string, @Query('desi') desi: string, @Req() req: any) {
    return this.kargo.calculatePrice(req.user.tenantId, provider, desi)
  }

  @Get('providers/detail/:id')
  async getProvidersDetail(@Param('id') id: string, @Req() req: any) {
    return this.kargo.getProvidersDetail(req.user.tenantId, id)
  }

  @Get('wallet')
  async getWalletBalance(@Req() req: any) {
    return this.kargo.getWalletBalance(req.user.tenantId)
  }
}
