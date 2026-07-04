import { Controller, Get, Post, Body, Req } from '@nestjs/common'
import { EInvoiceService } from './einvoice.service'
import { SendInvoiceRequest } from './types'

@Controller('einvoice')
export class EInvoiceController {
  constructor(private einvoiceService: EInvoiceService) {}

  @Get('config')
  async getConfig(@Req() req: any) {
    return this.einvoiceService.getConfig(req.user?.tenantId || '')
  }

  @Post('config')
  async saveConfig(@Req() req: any, @Body() body: any) {
    return this.einvoiceService.saveConfig(req.user?.tenantId || '', body)
  }

  @Post('test')
  async testConnection(@Req() req: any, @Body('provider') provider: string) {
    return this.einvoiceService.testConnection(req.user?.tenantId || '', provider)
  }

  @Post('templates')
  async fetchTemplates(@Req() req: any, @Body('provider') provider: string) {
    return this.einvoiceService.fetchTemplates(req.user?.tenantId || '', provider)
  }

  @Post('send')
  async sendInvoice(@Req() req: any, @Body() body: SendInvoiceRequest) {
    return this.einvoiceService.sendInvoice(req.user?.tenantId || '', body)
  }
}
