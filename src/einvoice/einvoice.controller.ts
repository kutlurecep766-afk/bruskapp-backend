import { Controller, Get, Post, Body, Req, HttpCode } from '@nestjs/common'
import { Public } from '../auth/public.decorator'
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

  @Public()
  @Post('test')
  @HttpCode(200)
  async testConnection(@Body() body: { provider: string; credentials?: Record<string, string> }) {
    const result = await this.einvoiceService.testConnection(body.provider, body.credentials)
    if (!result.success) {
      return { success: false, error: result.error || 'Bağlantı hatası' }
    }
    return { success: true, message: 'Bağlantı başarılı' }
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
