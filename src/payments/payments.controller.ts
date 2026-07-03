import { Controller, Post, Get, Body, Req, Query, Header, Param } from '@nestjs/common'
import { PaymentsService } from './payments.service'
import { Public } from '../auth/public.decorator'

@Controller('payments')
export class PaymentsController {
  constructor(private paymentsService: PaymentsService) {}

  @Post('virtual-pos/paytr/init')
  async initPayment(@Body() dto: any, @Req() req: any) {
    const tenantId = req.user.tenantId
    const userIp = req.headers['x-forwarded-for'] || req.ip || req.connection?.remoteAddress || '::1'
    return this.paymentsService.initPayment(tenantId, dto, userIp)
  }

  @Public()
  @Post('virtual-pos/paytr/callback')
  async handleCallback(@Body() body: any) {
    return this.paymentsService.handleCallback(body)
  }

  @Public()
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Get('virtual-pos/paytr/result')
  paymentResult(@Query() query: any) {
    const status = query.status === 'success' ? 'success' : 'failed'
    const message = status === 'success' ? 'Ödeme başarıyla tamamlandı.' : 'Ödeme sırasında bir hata oluştu.'
    const color = status === 'success' ? '#16a34a' : '#dc2626'
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Ödeme Sonucu</title></head><body><script>try{window.parent.postMessage({type:"PAYTR_RESULT",status:"${status}",merchantOid:"${query.oid||""}"},"*")}catch(e){}document.body.innerHTML='<div style="text-align:center;padding:40px;font-family:-apple-system,sans-serif;background:#f5f5f5;min-height:100vh;display:flex;align-items:center;justify-content:center"><div style="background:white;border-radius:12px;padding:40px;box-shadow:0 2px 10px rgba(0,0,0,0.1)"><h2 style="margin:0;color:${color}">${message}</h2><p style="color:#666;margin-top:8px">Bu sayfa kapatılabilir.</p></div></div>'</script></body></html>`
  }

  @Post('virtual-pos/paytr/link')
  async createPaymentLink(@Body() dto: { amount: number; description?: string; maxUsage?: number; expiryDays?: number }, @Req() req: any) {
    return this.paymentsService.createPaymentLink(req.user.tenantId, dto)
  }

  @Get('transactions')
  async getTransactions(@Req() req: any) {
    return this.paymentsService.getTransactions(req.user.tenantId)
  }

  @Post('virtual-pos/api-keys')
  async updateApiKeys(@Body() dto: { merchantId: string; merchantKey: string; merchantSecret: string }, @Req() req: any) {
    return this.paymentsService.updateApiKeys(req.user.tenantId, dto)
  }

  @Get('virtual-pos/api-keys')
  async getApiKeys(@Req() req: any) {
    return this.paymentsService.getApiKeysStatus(req.user.tenantId)
  }

  // Legal info
  @Post('virtual-pos/legal-info')
  async updateLegalInfo(@Body() dto: any, @Req() req: any) {
    return this.paymentsService.updateLegalInfo(req.user.tenantId, dto)
  }

  @Get('virtual-pos/legal-info')
  async getLegalInfo(@Req() req: any) {
    return this.paymentsService.getLegalInfo(req.user.tenantId)
  }

  // Public contract pages (PayTR requirement)
  @Public()
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Get('contracts/mesafeli-satis')
  async mesafeliSatis(@Query('tenant') slug: string, @Req() req: any) {
    const host = req.headers['host'] || ''
    return this.paymentsService.generateContract('mesafeli-satis', slug, host)
  }

  @Public()
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Get('contracts/iade')
  async iadePolitikasi(@Query('tenant') slug: string, @Req() req: any) {
    const host = req.headers['host'] || ''
    return this.paymentsService.generateContract('iade', slug, host)
  }

  // Storefront: public payment init (customer-facing, no auth)
  @Public()
  @Post('storefront/paytr/init')
  async storefrontInit(@Body() dto: { tenantSlug: string; amount: number; description?: string; name?: string; email?: string; phone?: string; address?: string }) {
    const userIp = '::1'
    return this.paymentsService.initPaymentBySlug(dto.tenantSlug, dto, userIp)
  }


  @Public()
  @Post('storefront/iyzico/init')
  async storefrontIyzicoInit(@Body() dto: { tenantSlug: string; amount: number; description?: string; name?: string; email?: string; phone?: string; address?: string }) {
    return this.paymentsService.iyzicoInitBySlug(dto.tenantSlug, dto)
  }

  // --- Iyzico ---
  @Post('iyzico/init')
  async iyzicoInit(@Body() dto: any, @Req() req: any) {
    return this.paymentsService.iyzicoInit(req.user.tenantId, dto)
  }

  @Public()
  @Post('iyzico/callback')
  async iyzicoCallback(@Body() body: any) {
    return this.paymentsService.iyzicoCallback(body)
  }

  @Public()
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Get('iyzico/result')
  iyzicoResult(@Query() query: any) {
    const status = query.status === 'success' ? 'success' : 'failed'
    const msg = status === 'success' ? 'Odeme basariyla tamamlandi.' : 'Odeme sirasinda bir hata olustu.'
    const color = status === 'success' ? '#16a34a' : '#dc2626'
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Odeme Sonucu</title></head><body><script>try{window.parent.postMessage({type:"PAYTR_RESULT",status:"${status}",merchantOid:"${query.oid||""}"},"*")}catch(e){}document.body.innerHTML='<div style="text-align:center;padding:40px;font-family:-apple-system,sans-serif;background:#f5f5f5;min-height:100vh;display:flex;align-items:center;justify-content:center"><div style="background:white;border-radius:12px;padding:40px;box-shadow:0 2px 10px rgba(0,0,0,0.1)"><h2 style="margin:0;color:${color}">${msg}</h2><p style="color:#666;margin-top:8px">Bu sayfa kapatilabilir.</p></div></div>'</script></body></html>`
  }

  @Post('iyzico/api-keys')
  async updateIyzicoKeys(@Body() dto: { apiKey: string; secretKey: string }, @Req() req: any) {
    return this.paymentsService.updateApiKeys(req.user.tenantId, dto, 'iyzico')
  }

  // --- Sipay ---
  @Post('sipay/init')
  async sipayInit(@Body() dto: any, @Req() req: any) {
    const userIp = req.headers['x-forwarded-for'] || req.ip || req.connection?.remoteAddress || '::1'
    return this.paymentsService.sipayInit(req.user.tenantId, dto, userIp)
  }

  @Public()
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Get('sipay/result')
  sipayResult(@Query() query: any) {
    const status = query.status === 'success' ? 'success' : 'failed'
    const msg = status === 'success' ? 'Odeme basariyla tamamlandi.' : 'Odeme sirasinda bir hata olustu.'
    const color = status === 'success' ? '#16a34a' : '#dc2626'
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Odeme Sonucu</title></head><body><script>try{window.parent.postMessage({type:"PAYTR_RESULT",status:"${status}",merchantOid:"${query.oid||""}"},"*")}catch(e){}document.body.innerHTML='<div style="text-align:center;padding:40px;font-family:-apple-system,sans-serif;background:#f5f5f5;min-height:100vh;display:flex;align-items:center;justify-content:center"><div style="background:white;border-radius:12px;padding:40px;box-shadow:0 2px 10px rgba(0,0,0,0.1)"><h2 style="margin:0;color:${color}">${msg}</h2><p style="color:#666;margin-top:8px">Bu sayfa kapatilabilir.</p></div></div>'</script></body></html>`
  }

  @Post('sipay/api-keys')
  async updateSipayKeys(@Body() dto: { merchantKey: string; appId: string; appSecret: string }, @Req() req: any) {
    return this.paymentsService.updateApiKeys(req.user.tenantId, dto as any, 'sipay')
  }

  @Public()
  @Post('storefront/sipay/init')
  async storefrontSipayInit(@Body() dto: { tenantSlug: string; amount: number; description?: string; name?: string; email?: string; phone?: string; address?: string; cardNumber?: string; cardHolderName?: string; cardMonth?: string; cardYear?: string; cardCvv?: string }) {
    return this.paymentsService.sipayInitBySlug(dto.tenantSlug, dto)
  }

  // --- Ödeal ---
  @Post('odeal/init')
  async odealInit(@Body() dto: any, @Req() req: any) {
    const userIp = req.headers['x-forwarded-for'] || req.ip || req.connection?.remoteAddress || '::1'
    return this.paymentsService.odealInit(req.user.tenantId, dto, userIp)
  }

  @Public()
  @Post('odeal/callback')
  async odealCallback(@Body() body: any) {
    return this.paymentsService.odealCallback(body)
  }

  @Public()
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Get('odeal/result')
  odealResult(@Query() query: any) {
    const status = query.status === 'success' ? 'success' : 'failed'
    const msg = status === 'success' ? 'Ödeme başarıyla tamamlandı.' : 'Ödeme sırasında bir hata oluştu.'
    const color = status === 'success' ? '#16a34a' : '#dc2626'
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Ödeme Sonucu</title></head><body><script>try{window.parent.postMessage({type:"PAYTR_RESULT",status:"${status}",merchantOid:"${query.oid||""}"},"*")}catch(e){}document.body.innerHTML='<div style="text-align:center;padding:40px;font-family:-apple-system,sans-serif;background:#f5f5f5;min-height:100vh;display:flex;align-items:center;justify-content:center"><div style="background:white;border-radius:12px;padding:40px;box-shadow:0 2px 10px rgba(0,0,0,0.1)"><h2 style="margin:0;color:${color}">${msg}</h2><p style="color:#666;margin-top:8px">Bu sayfa kapatılabilir.</p></div></div>'</script></body></html>`
  }

  @Post('odeal/link')
  async odealCreateLink(@Body() dto: { amount: number; description?: string }, @Req() req: any) {
    return this.paymentsService.odealCreateLink(req.user.tenantId, dto)
  }

  @Post('odeal/api-keys')
  async updateOdealKeys(@Body() dto: { apiKey: string; secretKey: string }, @Req() req: any) {
    return this.paymentsService.updateApiKeys(req.user.tenantId, dto as any, 'odeal')
  }

  @Public()
  @Post('storefront/odeal/init')
  async storefrontOdealInit(@Body() dto: { tenantSlug: string; amount: number; description?: string; name?: string; email?: string; phone?: string; address?: string }) {
    return this.paymentsService.odealInitBySlug(dto.tenantSlug, dto)
  }

  @Post('installment-settings')
  async getInstallmentSettings(@Req() req: any) {
    return this.paymentsService.getInstallmentSettings(req.user.tenantId)
  }

  @Post('installment-settings/update')
  async updateInstallmentSettings(@Body() dto: any, @Req() req: any) {
    return this.paymentsService.updateInstallmentSettings(req.user.tenantId, dto)
  }

  @Post('bin-check')
  async binCheck(@Body() dto: { bin: string; amount: number }, @Req() req: any) {
    return this.paymentsService.binCheck(req.user.tenantId, dto)
  }


}