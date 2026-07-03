import { Injectable, HttpException, HttpStatus } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { PrismaService } from '../prisma.service'
import { firstValueFrom } from 'rxjs'
import * as crypto from 'crypto'

@Injectable()
export class PaymentsService {
  constructor(
    private prisma: PrismaService,
    private http: HttpService,
  ) {}

  private async getPaytrKeys(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } })
    const keys = (tenant?.apiKeys as any)?.paytr
    if (!keys?.merchantId || !keys?.merchantKey || !keys?.merchantSecret) {
      throw new HttpException('PayTR API anahtarları tanımlanmamış. Lütfen SanalPOS ayarlarından ekleyin.', HttpStatus.BAD_REQUEST)
    }
    return keys as { merchantId: string; merchantKey: string; merchantSecret: string }
  }

  private async getIyzicoKeys(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } })
    const keys = (tenant?.apiKeys as any)?.iyzico
    if (!keys?.apiKey || !keys?.secretKey) {
      throw new HttpException('Iyzico API anahtarlari tanimlanmamis.', HttpStatus.BAD_REQUEST)
    }
    return keys as { apiKey: string; secretKey: string }
  }

  async initPayment(tenantId: string, dto: any, userIp: string) {
    const keys = await this.getPaytrKeys(tenantId)
    const merchantOid = `BRSK-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
    const amount = Math.round(dto.amount * 100)

    const okUrl = `https://bruskapp.com/api/payments/virtual-pos/paytr/result?status=success&oid=${merchantOid}`
    const failUrl = `https://bruskapp.com/api/payments/virtual-pos/paytr/result?status=fail&oid=${merchantOid}`

    const userBasket = Buffer.from(JSON.stringify([[dto.description || 'Ürün', String(dto.amount), 1]])).toString('base64')
    const noInstallment = dto.installment && dto.installment > 1 ? '0' : '1'
    const maxInstallment = dto.installment && dto.installment > 1 ? String(dto.installment) : '0'
    const hashStr = keys.merchantId + userIp + merchantOid + (dto.email || 'musteri@ornek.com') + String(amount) + userBasket + noInstallment + maxInstallment + 'TL' + '0'
    const paytrToken = crypto.createHmac('sha256', keys.merchantKey).update(hashStr + keys.merchantSecret).digest('base64')

    const body = new URLSearchParams({
      merchant_id: keys.merchantId,
      user_ip: userIp,
      merchant_oid: merchantOid,
      email: dto.email || 'musteri@ornek.com',
      payment_amount: String(amount),
      paytr_token: paytrToken,
      user_basket: userBasket,
      no_installment: noInstallment,
      max_installment: maxInstallment,
      user_name: dto.name || '',
      user_address: dto.address || '',
      user_phone: dto.phone || '',
      merchant_ok_url: okUrl,
      merchant_fail_url: failUrl,
      currency: 'TL',
      timeout_limit: '30',
      debug_on: '1',
      test_mode: '0',
      lang: 'tr',
    })

    let response
    try {
      response = await firstValueFrom(
        this.http.post('https://www.paytr.com/odeme/api/get-token', body.toString(), {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        })
      )
    } catch (e: any) {
      throw new HttpException('PayTR bağlantı hatası: ' + (e?.response?.data?.err_msg || e.message), HttpStatus.BAD_GATEWAY)
    }

    if (response.data.status !== 'success') {
      throw new HttpException('PayTR token alınamadı: ' + (response.data.err_msg || 'bilinmeyen hata'), HttpStatus.BAD_REQUEST)
    }

    await this.prisma.paymentTransaction.create({
      data: {
        tenantId,
        merchantOid,
        amount,
        currency: 'TL',
        status: 'pending',
        customerEmail: dto.email,
        customerName: dto.name,
        customerPhone: dto.phone,
        description: dto.description,
      },
    })

    return { token: response.data.token, merchantOid }
  }

  async handleCallback(body: any) {
    const { merchant_oid, status, total_amount, hash } = body
    if (!merchant_oid) throw new HttpException('Geçersiz callback', HttpStatus.BAD_REQUEST)

    const tx = await this.prisma.paymentTransaction.findUnique({ where: { merchantOid: merchant_oid } })
    if (!tx) throw new HttpException('İşlem bulunamadı', HttpStatus.NOT_FOUND)

    const keys = await this.getPaytrKeys(tx.tenantId)
    const expectedHash = crypto.createHmac('sha256', keys.merchantKey)
      .update(merchant_oid + keys.merchantSecret + status + total_amount)
      .digest('base64')

    if (hash !== expectedHash) {
      throw new HttpException('Geçersiz imza', HttpStatus.FORBIDDEN)
    }

    await this.prisma.paymentTransaction.update({
      where: { merchantOid: merchant_oid },
      data: {
        status: status === 'success' ? 'success' : 'failed',
        ...(body.card_brand ? { cardBrand: body.card_brand } : {}),
        ...(body.installment ? { installment: Number(body.installment) } : {}),
      },
    })

    return { status, merchantOid: merchant_oid }
  }

  async createPaymentLink(tenantId: string, dto: any) {
    const keys = await this.getPaytrKeys(tenantId)
    const amount = Math.round(dto.amount * 100)
    const linkId = `LINK-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
    const name = dto.description || 'Ödeme'
    const linkType = 'product'
    const lang = 'tr'
    const currency = 'TL'
    const minCount = '1'
    const maxInstallmentLink = dto.installment && dto.installment > 1 ? String(dto.installment) : '1'

    const paytrToken = crypto.createHmac('sha256', keys.merchantKey)
      .update(name + String(amount) + currency + maxInstallmentLink + linkType + lang + minCount + keys.merchantSecret)
      .digest('base64')

    const body = new URLSearchParams({
      merchant_id: keys.merchantId,
      name,
      price: String(amount),
      currency,
      max_installment: maxInstallmentLink,
      link_type: linkType,
      lang,
      min_count: minCount,
      paytr_token: paytrToken,
      debug_on: '1',
    })

    let response
    try {
      response = await firstValueFrom(
        this.http.post('https://www.paytr.com/odeme/api/link/create', body.toString(), {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        })
      )
    } catch (e: any) {
      throw new HttpException('PayTR bağlantı hatası: ' + (e?.response?.data?.err_msg || e.message), HttpStatus.BAD_GATEWAY)
    }

    if (response.data.status !== 'success') {
      throw new HttpException('PayTR link oluşturulamadı: ' + (response.data.err_msg || 'bilinmeyen hata'), HttpStatus.BAD_REQUEST)
    }

    await this.prisma.paymentTransaction.create({
      data: {
        tenantId,
        merchantOid: linkId,
        amount,
        currency: 'TL',
        status: 'pending',
        description: dto.description,
      },
    })

    return { link: response.data.link, linkId }
  }

  async getTransactions(tenantId: string) {
    return this.prisma.paymentTransaction.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
  }

  async updateApiKeys(tenantId: string, dto: { merchantId?: string; merchantKey?: string; merchantSecret?: string; apiKey?: string; secretKey?: string; clientCode?: string; clientUsername?: string; clientPassword?: string; guid?: string; appId?: string; appSecret?: string }, provider: string = 'paytr') {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } })
    const currentKeys = (tenant?.apiKeys as any) || {}
    if (provider == 'paytr') {
      currentKeys.paytr = { merchantId: dto.merchantId, merchantKey: dto.merchantKey, merchantSecret: dto.merchantSecret }
    } else if (provider == 'iyzico') {
      currentKeys.iyzico = { apiKey: dto.apiKey || '', secretKey: dto.secretKey || '' }
    } else if (provider == 'sipay') {
      currentKeys.sipay = { merchantKey: dto.merchantKey || '', appId: dto.appId || '', appSecret: dto.appSecret || '' }
    } else if (provider == 'odeal') {
      currentKeys.odeal = { apiKey: dto.apiKey || '', secretKey: dto.secretKey || '' }
    }
    return this.prisma.tenant.update({
      where: { id: tenantId },
      data: { apiKeys: currentKeys },
      select: { id: true, name: true, apiKeys: true },
    })
  }

  async getApiKeysStatus(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } })
    const allKeys = (tenant?.apiKeys as any) || {}
    const paytr = allKeys.paytr
    const iyzico = allKeys.iyzico
    const sipay = allKeys.sipay
    const odeal = allKeys.odeal
    return {
      slug: tenant?.slug || '',
      paytr: { configured: !!(paytr?.merchantId && paytr?.merchantKey && paytr?.merchantSecret), merchantId: paytr?.merchantId || '' },
      iyzico: { configured: !!(iyzico?.apiKey && iyzico?.secretKey), apiKey: iyzico?.apiKey || '' },
      sipay: { configured: !!(sipay?.merchantKey && sipay?.appId && sipay?.appSecret), merchantKey: sipay?.merchantKey || '' },
      odeal: { configured: !!(odeal?.apiKey && odeal?.secretKey), apiKey: odeal?.apiKey || '' },
    }
  }

  async updateLegalInfo(tenantId: string, dto: { title: string; taxOffice: string; taxNumber: string; address: string; phone: string; email: string }) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } })
    const currentKeys = (tenant?.apiKeys as any) || {}
    currentKeys.legalInfo = {
      title: dto.title || '',
      taxOffice: dto.taxOffice || '',
      taxNumber: dto.taxNumber || '',
      address: dto.address || '',
      phone: dto.phone || '',
      email: dto.email || 'musteri@ornek.com',
    }
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { apiKeys: currentKeys },
    })
    return { success: true }
  }

  async getLegalInfo(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } })
    const info = (tenant?.apiKeys as any)?.legalInfo
    return info || { title: '', taxOffice: '', taxNumber: '', address: '', phone: '', email: '' }
  }

  async generateContract(type: string, slug: string, host?: string) {
    let tenant;
    if (slug) {
      tenant = await this.prisma.tenant.findUnique({ where: { slug } })
    } else if (host) {
      tenant = await this.prisma.tenant.findUnique({ where: { domain: host } })
      if (!tenant) {
        const match = host.match(/^(.+?)\.bruskapp\.com(?::\d+)?$/)
        if (match) { tenant = await this.prisma.tenant.findUnique({ where: { slug: match[1] } }) }
      }
    }
    if (!tenant) return '<!DOCTYPE html><html><body><h1>İşletme bulunamadı</h1></body></html>'

    const info = (tenant.apiKeys as any)?.legalInfo || {}
    const now = new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })

    if (type === 'mesafeli-satis') {
      return `<!DOCTYPE html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mesafeli Satış Sözleşmesi - ${tenant.name}</title><style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:800px;margin:0 auto;padding:40px 20px;line-height:1.8;color:#333}h1{font-size:24px;border-bottom:2px solid #000;padding-bottom:10px}h2{font-size:18px;margin-top:30px}p{margin:10px 0}.footer{margin-top:50px;padding-top:20px;border-top:1px solid #ddd;font-size:14px;color:#666}</style></head><body><h1>Mesafeli Satış Sözleşmesi</h1><p><strong>${info.title || tenant.name}</strong></p><p>${info.address || ''}</p><p>Vergi Dairesi: ${info.taxOffice || ''} &nbsp;|&nbsp; Vergi No: ${info.taxNumber || ''}</p><p>Telefon: ${info.phone || ''} &nbsp;|&nbsp; E-posta: ${info.email || ''}</p><hr><h2>Madde 1 - Taraflar</h2><p>İşbu sözleşme, yukarıda ünvanı ve adresi yazılı SATICI ile ALICI arasında aşağıdaki ürün/hizmetin satışına ilişkin olarak elektronik ortamda akdedilmiştir.</p><h2>Madde 2 - Konu</h2><p>İşbu sözleşme, ALICI'nın SATICI'ya ait internet sitesinden sipariş vermesi durumunda, tarafların hak ve yükümlülüklerini düzenler.</p><h2>Madde 3 - Cayma Hakkı</h2><p>ALICI, malın tesliminden itibaren 14 gün içinde hiçbir gerekçe göstermeksizin ve cezai şart ödemeksizin sözleşmeden cayma hakkına sahiptir. Cayma hakkının kullanımı için SATICI'ya bildirim yapılması yeterlidir.</p><h2>Madde 4 - Teslimat</h2><p>Ürünler, sipariş tarihinden itibaren en geç 30 gün içinde teslim edilir. Bu süre içinde teslimat yapılamaması halinde ALICI'ya bilgi verilir.</p><p class="footer">Sözleşme tarihi: ${now}<br>${tenant.name} - ${info.title || ''}</p></body></html>`
    }

    if (type === 'iade') {
      return `<!DOCTYPE html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>İptal ve İade Politikası - ${tenant.name}</title><style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:800px;margin:0 auto;padding:40px 20px;line-height:1.8;color:#333}h1{font-size:24px;border-bottom:2px solid #000;padding-bottom:10px}h2{font-size:18px;margin-top:30px}p{margin:10px 0}.footer{margin-top:50px;padding-top:20px;border-top:1px solid #ddd;font-size:14px;color:#666}</style></head><body><h1>İptal ve İade Politikası</h1><p><strong>${info.title || tenant.name}</strong></p><p>${info.address || ''}</p><p>Telefon: ${info.phone || ''} &nbsp;|&nbsp; E-posta: ${info.email || ''}</p><hr><h2>İade Koşulları</h2><p>Müşterilerimiz, teslimat tarihinden itibaren 14 gün içinde hiçbir gerekçe göstermeksizin ürünü iade edebilir.</p><h2>İade Süreci</h2><p>İade talebinizi ${info.phone || 'telefon'} veya ${info.email || 'e-posta'} üzerinden bize iletebilirsiniz. İade başvurusu onaylandıktan sonra ürünü anlaşmalı kargo ile gönderebilirsiniz.</p><h2>Para İadesi</h2><p>İade onaylandıktan sonra ödeme tutarı, 14 gün içinde ALICI'nın kullandığı ödeme yöntemiyle iade edilir.</p><h2>İade Edilemeyecek Ürünler</h2><p>Kişiselleştirilmiş ürünler, hijyen ürünleri ve elektronik yazılım ürünleri iade edilemez.</p><p class="footer">Son güncelleme: ${now}<br>${tenant.name}</p></body></html>`
    }

    return '<!DOCTYPE html><html><body><h1>Sözleşme bulunamadı</h1></body></html>'
  }

  async initPaymentBySlug(tenantSlug: string, dto: any, userIp: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { slug: tenantSlug } })
    if (!tenant) throw new HttpException('İşletme bulunamadı', HttpStatus.NOT_FOUND)
    return this.initPayment(tenant.id, dto, userIp)
  }

  async iyzicoInitBySlug(tenantSlug: string, dto: any) {
    const tenant = await this.prisma.tenant.findUnique({ where: { slug: tenantSlug } })
    if (!tenant) throw new HttpException('İşletme bulunamadı', HttpStatus.NOT_FOUND)
    return this.iyzicoInit(tenant.id, dto)
  }

  async iyzicoInit(tenantId: string, dto: any) {
    const keys = await this.getIyzicoKeys(tenantId)
    const merchantOid = 'BRSK-' + Date.now() + '-' + Math.random().toString(36).substring(2, 8)
    const amount = Math.round(dto.amount * 100)

    const okUrl = 'https://bruskapp.com/api/payments/iyzico/result?status=success&oid=' + merchantOid
    const failUrl = 'https://bruskapp.com/api/payments/iyzico/result?status=fail&oid=' + merchantOid

    const iyziReq = {
      locale: 'tr',
      conversationId: merchantOid,
      price: String(dto.amount),
      paidPrice: String(dto.amount),
      currency: 'TRY',
      installment: String(dto.installment || '1'),
      basketId: merchantOid,
      paymentGroup: 'PRODUCT',
      callbackUrl: okUrl,
      failCallbackUrl: failUrl,
      enabledInstallments: dto.installment && dto.installment > 1 ? Array.from({length: dto.installment}, (_, i) => String(i + 1)) : ['1'],
      buyer: {
        id: 'BYR-' + merchantOid, name: dto.name || 'Musteri', surname: dto.surname || '',
        gsmNumber: dto.phone || '+905551111111', email: dto.email || 'musteri@ornek.com',
        identityNumber: '11111111111', registrationAddress: dto.address || 'N/A',
        ip: '85.34.78.112', city: 'Istanbul', country: 'Turkey', zipCode: '34000',
      },
      shippingAddress: { contactName: dto.name || 'Musteri', city: 'Istanbul', country: 'Turkey', address: dto.address || 'N/A', zipCode: '34000' },
      billingAddress: { contactName: dto.name || 'Musteri', city: 'Istanbul', country: 'Turkey', address: dto.address || 'N/A', zipCode: '34000' },
      basketItems: [{ id: 'ITEM-001', name: dto.description || 'Urun', category1: 'Genel', itemType: 'VIRTUAL', price: String(dto.amount) }],
    }

    const randomStr = crypto.randomUUID()
    const uriPath = '/payment/iyzipos/checkoutform/initialize/ecom'
    const bodyStr = JSON.stringify(iyziReq)
    const payload = randomStr + uriPath + bodyStr
    const encryptedData = crypto.createHmac('sha256', keys.secretKey).update(payload).digest('hex')
    const authStr = 'apiKey:' + keys.apiKey + '&randomKey:' + randomStr + '&signature:' + encryptedData
    const authorization = 'IYZWSv2 ' + Buffer.from(authStr).toString('base64')

    try {
      const response = await firstValueFrom(
        this.http.post('https://api.iyzipay.com' + uriPath, bodyStr, {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': authorization,
          },
        })
      )
      if (response.data?.status === 'success') {
        await this.prisma.paymentTransaction.create({
          data: { tenantId, merchantOid, amount, currency: 'TRY', status: 'pending', customerEmail: dto.email, customerName: dto.name, customerPhone: dto.phone, description: dto.description },
        })
        return { token: response.data.token, iframeUrl: response.data.threeDSHtmlContent || response.data.paymentPageUrl, merchantOid }
      }
      throw new HttpException('Iyzico hatasi: ' + (response.data?.errorMessage || 'bilinmeyen hata'), HttpStatus.BAD_REQUEST)
    } catch (e: any) {
      if (e instanceof HttpException) throw e
      throw new HttpException('Iyzico baglanti hatasi', HttpStatus.BAD_REQUEST)
    }
  }

  async iyzicoCallback(body: any) {
    const { token, status, conversationId } = body
    if (!token) throw new HttpException('Gecersiz callback', HttpStatus.BAD_REQUEST)
    const tx = await this.prisma.paymentTransaction.findUnique({ where: { merchantOid: conversationId } })
    if (!tx) throw new HttpException('Islem bulunamadi', HttpStatus.NOT_FOUND)
    await this.prisma.paymentTransaction.update({ where: { merchantOid: conversationId }, data: { status: status === 'success' ? 'success' : 'failed' } })
    return { status, merchantOid: conversationId }
  }

  // --- Sipay ---

  private async getSipayKeys(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } })
    const keys = (tenant?.apiKeys as any)?.sipay
    if (!keys?.merchantKey || !keys?.appId || !keys?.appSecret) {
      throw new HttpException('Sipay API anahtarlari tanimlanmamis.', HttpStatus.BAD_REQUEST)
    }
    return keys as { merchantKey: string; appId: string; appSecret: string }
  }

  private async sipayToken(keys: { appId: string; appSecret: string }) {
    let res
    try {
      res = await firstValueFrom(
        this.http.post('https://app.sipay.com.tr/ccpayment/api/token', {
          app_id: keys.appId,
          app_secret: keys.appSecret,
          app_lang: 'tr',
        })
      )
    } catch (e: any) {
      throw new HttpException('Sipay token alinamadi: ' + (e?.response?.data?.status_description || e.message), HttpStatus.BAD_GATEWAY)
    }
    if (res.data?.status_code !== 100 || !res.data?.data?.token) {
      throw new HttpException('Sipay token alinamadi', HttpStatus.BAD_GATEWAY)
    }
    return res.data.data.token as string
  }

  async sipayInit(tenantId: string, dto: any, userIp: string) {
    const keys = await this.getSipayKeys(tenantId)
    const token = await this.sipayToken(keys)
    const merchantOid = 'BRSK-' + Date.now() + '-' + Math.random().toString(36).substring(2, 8)
    const amount = Math.round(dto.amount * 100) / 100
    const invoiceId = merchantOid
    const installment = dto.installment || 1

    const okUrl = 'https://bruskapp.com/api/payments/sipay/result?status=success&oid=' + merchantOid
    const cancelUrl = 'https://bruskapp.com/api/payments/sipay/result?status=fail&oid=' + merchantOid

    const hashStr = String(amount) + String(installment) + 'TRY' + keys.merchantKey + invoiceId + keys.appSecret
    const hashKey = crypto.createHash('sha256').update(hashStr).digest('base64')

    const items = JSON.stringify([
      { name: dto.description || 'Urun', price: String(amount), quantity: 1, description: dto.description || 'Urun' }
    ])

    const body: any = {
      cc_holder_name: dto.cardHolderName || dto.name || '',
      cc_no: (dto.cardNumber || '').replace(/\s/g, ''),
      expiry_month: dto.cardMonth || '',
      expiry_year: dto.cardYear || '',
      cvv: dto.cardCvv || '',
      currency_code: 'TRY',
      installments_number: String(installment),
      invoice_id: invoiceId,
      invoice_description: dto.description || 'Odeme',
      name: dto.name || (dto.cardHolderName || '').split(' ')[0] || '',
      surname: dto.surname || '',
      total: String(amount),
      merchant_key: keys.merchantKey,
      items,
      cancel_url: cancelUrl,
      return_url: okUrl,
      hash_key: hashKey,
      ip: userIp,
      response_method: 'POST',
      app_lang: 'tr',
    }

    let response
    try {
      response = await firstValueFrom(
        this.http.post('https://app.sipay.com.tr/ccpayment/api/paySmart3D', body, {
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        })
      )
    } catch (e: any) {
      throw new HttpException('Sipay baglanti hatasi: ' + (e?.response?.data?.error || e.message), HttpStatus.BAD_GATEWAY)
    }

    const data = response.data

    if (typeof data === 'string' && data.includes('<!DOCTYPE html>')) {
      return { threeDSecureHtmlContent: data, merchantOid, invoiceId }
    }

    if (data?.status_code === 100 && data?.payment_status === '1') {
      await this.prisma.paymentTransaction.create({
        data: { tenantId, merchantOid, amount: Math.round(amount * 100), currency: 'TRY', status: 'success', customerEmail: dto.email, customerName: dto.name, customerPhone: dto.phone, description: dto.description },
      })
      return { status: 'success', merchantOid, orderNo: data.order_no, orderId: data.order_id, invoiceId: data.invoice_id }
    }

    throw new HttpException('Sipay odeme hatasi: ' + (data?.error || data?.status_description || 'bilinmeyen hata'), HttpStatus.BAD_REQUEST)
  }

  async sipayInitBySlug(tenantSlug: string, dto: any) {
    const tenant = await this.prisma.tenant.findUnique({ where: { slug: tenantSlug } })
    if (!tenant) throw new HttpException('Isletme bulunamadi', HttpStatus.NOT_FOUND)
    return this.sipayInit(tenant.id, dto, '::1')
  }

  // --- Ödeal ---

  private async getOdealKeys(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } })
    const keys = (tenant?.apiKeys as any)?.odeal
    if (!keys?.apiKey || !keys?.secretKey) {
      throw new HttpException('Ödeal API anahtarları tanımlanmamış. Lütfen SanalPOS ayarlarından ekleyin.', HttpStatus.BAD_REQUEST)
    }
    return keys as { apiKey: string; secretKey: string }
  }

  private async getOdealToken(keys: { apiKey: string; secretKey: string }) {
    let res
    try {
      res = await firstValueFrom(
        this.http.post('https://api.odeal.com/token', {
          clientId: keys.apiKey,
          clientSecret: keys.secretKey,
          grant_type: 'client_credentials',
          scope: 'pos',
        }, {
          headers: { 'Content-Type': 'application/json' },
        })
      )
    } catch (e: any) {
      throw new HttpException('Ödeal token alınamadı: ' + (e?.response?.data?.message || e.message), HttpStatus.BAD_GATEWAY)
    }
    const token = res.data?.access_token || res.data?.result?.accessToken
    if (!token) {
      throw new HttpException('Ödeal token alınamadı', HttpStatus.BAD_GATEWAY)
    }
    return token as string
  }

  async odealInit(tenantId: string, dto: any, userIp: string) {
    const keys = await this.getOdealKeys(tenantId)
    const merchantOid = `BRSK-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`

    let token
    try {
      token = await this.getOdealToken(keys)
    } catch (e: any) {
      throw new HttpException('Ödeal token alınamadı: ' + (e?.response?.data?.message || e.message), HttpStatus.BAD_GATEWAY)
    }

    const callbackUrl = 'https://bruskapp.com/api/payments/odeal/callback'
    const successUrl = 'https://bruskapp.com/api/payments/odeal/result?status=success&oid=' + merchantOid
    const failUrl = 'https://bruskapp.com/api/payments/odeal/result?status=fail&oid=' + merchantOid

    const amount = Math.round(dto.amount * 100)

    const body: any = {
      amount: dto.amount,
      externalId: merchantOid,
      returnUrl: callbackUrl,
      successRedirectUrl: successUrl,
      failureRedirectUrl: failUrl,
      installment: dto.installment || 1,
      buyer: {
        buyerName: dto.name || 'Musteri',
        buyerMail: dto.email || 'musteri@ornek.com',
        buyerAddress: dto.address || 'N/A',
        buyerCity: 'Istanbul',
      },
    }

    if (dto.cardNumber) {
      body.card = {
        cardNumber: dto.cardNumber,
        cardHolderName: dto.cardHolderName || '',
        month: dto.cardMonth || '',
        year: dto.cardYear || '',
        cvv: dto.cardCvv || '',
      }
    }

    let response
    try {
      response = await firstValueFrom(
        this.http.post('https://api.odeal.com/vpos/init-3d', body, {
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        })
      )
    } catch (e: any) {
      throw new HttpException('Ödeal bağlantı hatası: ' + (e?.response?.data?.message || e.message), HttpStatus.BAD_GATEWAY)
    }

    if (response.data?.result !== 'success') {
      throw new HttpException('Ödeal 3D başlatılamadı: ' + (response.data?.message || 'bilinmeyen hata'), HttpStatus.BAD_REQUEST)
    }

    await this.prisma.paymentTransaction.create({
      data: {
        tenantId, merchantOid, amount, currency: 'TRY', status: 'pending',
        customerEmail: dto.email, customerName: dto.name, customerPhone: dto.phone, description: dto.description,
      },
    })

    const threeDFormHtml = response.data?.data?.threeDFormHtml || ''
    return {
      token: response.data?.data?.id || '',
      threeDFormHtml,
      threeDSecureHtmlContent: threeDFormHtml,
      merchantOid,
    }
  }

  async odealCreateLink(tenantId: string, dto: any) {
    const keys = await this.getOdealKeys(tenantId)
    const merchantOid = `LINK-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`

    let token
    try {
      token = await this.getOdealToken(keys)
    } catch (e: any) {
      throw new HttpException('Ödeal token alınamadı: ' + (e?.response?.data?.message || e.message), HttpStatus.BAD_GATEWAY)
    }

    let response
    try {
      response = await firstValueFrom(
        this.http.post('https://api.odeal.com/vpos/pay-by-link', {
          amount: dto.amount,
          externalId: merchantOid,
          returnUrl: 'https://bruskapp.com/api/payments/odeal/callback',
        }, {
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        })
      )
    } catch (e: any) {
      throw new HttpException('Ödeal bağlantı hatası: ' + (e?.response?.data?.message || e.message), HttpStatus.BAD_GATEWAY)
    }

    if (response.data?.result !== 'success') {
      throw new HttpException('Ödeal link oluşturulamadı: ' + (response.data?.message || 'bilinmeyen hata'), HttpStatus.BAD_REQUEST)
    }

    await this.prisma.paymentTransaction.create({
      data: {
        tenantId, merchantOid, amount: Math.round(dto.amount * 100), currency: 'TRY', status: 'pending',
        description: dto.description,
      },
    })

    return { link: response.data?.data?.checkout3DUrl || '', linkId: merchantOid }
  }

  async odealCallback(body: any) {
    const { externalId, status, id } = body
    if (!externalId) throw new HttpException('Geçersiz callback', HttpStatus.BAD_REQUEST)
    const tx = await this.prisma.paymentTransaction.findUnique({ where: { merchantOid: externalId } })
    if (!tx) throw new HttpException('İşlem bulunamadı', HttpStatus.NOT_FOUND)

    const newStatus = status === 'success' || status === 'COMPLETED' ? 'success' : 'failed'
    await this.prisma.paymentTransaction.update({
      where: { merchantOid: externalId },
      data: { status: newStatus },
    })

    return { status: newStatus, merchantOid: externalId }
  }

  async odealInitBySlug(tenantSlug: string, dto: any) {
    const tenant = await this.prisma.tenant.findUnique({ where: { slug: tenantSlug } })
    if (!tenant) throw new HttpException('İşletme bulunamadı', HttpStatus.NOT_FOUND)
    return this.odealInit(tenant.id, dto, '::1')
  }

  async getInstallmentSettings(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } })
    const settings = (tenant?.apiKeys as any)?.installmentSettings || {}
    return {
      paytr: settings.paytr || { enabled: true, maxInstallment: 12, allowedInstallments: [1, 2, 3, 6, 9, 12] },
      iyzico: settings.iyzico || { enabled: true, maxInstallment: 12, allowedInstallments: [1, 2, 3, 6, 9, 12] },
      sipay: settings.sipay || { enabled: true, maxInstallment: 12, allowedInstallments: [1, 2, 3, 6, 9, 12] },
      odeal: settings.odeal || { enabled: true, maxInstallment: 12, allowedInstallments: [1, 2, 3, 6, 9, 12] },
    }
  }

  async updateInstallmentSettings(tenantId: string, dto: any) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } })
    const currentKeys = (tenant?.apiKeys as any) || {}
    currentKeys.installmentSettings = dto
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { apiKeys: currentKeys },
    })
    return { success: true }
  }

  async binCheck(tenantId: string, dto: { bin: string; amount: number }) {
    const settings = await this.getInstallmentSettings(tenantId)
    const provider = 'iyzico'
    const allowed = settings[provider]?.allowedInstallments || [1, 2, 3, 6, 9, 12]
    const maxInst = settings[provider]?.maxInstallment || 12

    // Try iyzico API if tenant has iyzico keys
    try {
      const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } })
      const keys = (tenant?.apiKeys as any)?.iyzico
      if (keys?.apiKey && keys?.secretKey) {
        const randomStr = crypto.randomUUID()
        const uriPath = '/payment/iyzipos/installment'
        const bodyStr = JSON.stringify({ locale: 'tr', conversationId: 'BIN-' + Date.now(), binNumber: dto.bin, price: String(dto.amount) })
        const payload = randomStr + uriPath + bodyStr
        const encryptedData = crypto.createHmac('sha256', keys.secretKey).update(payload).digest('hex')
        const authStr = 'apiKey:' + keys.apiKey + '&randomKey:' + randomStr + '&signature:' + encryptedData
        const authorization = 'IYZWSv2 ' + Buffer.from(authStr).toString('base64')

        const res = await firstValueFrom(
          this.http.post('https://api.iyzipay.com' + uriPath, bodyStr, {
            headers: { 'Content-Type': 'application/json', 'Authorization': authorization },
          })
        )

        if (res.data?.status === 'success' && Array.isArray(res.data?.installmentPrices)) {
          const filtered = res.data.installmentPrices
            .filter((ip: any) => allowed.includes(ip.installmentNumber) && ip.installmentNumber <= maxInst)
            .map((ip: any) => ({
              number: ip.installmentNumber,
              totalPrice: ip.totalPrice,
              installmentPrice: ip.installmentPrice,
            }))
          if (filtered.length > 0) return filtered
        }
      }
    } catch {}

    // Fallback: return settings-based defaults
    return allowed.filter((n: number) => n <= maxInst && n <= 12).map((n: number) => ({
      number: n,
      totalPrice: dto.amount,
      installmentPrice: n === 1 ? dto.amount : Math.round((dto.amount / n) * 100) / 100,
    }))
  }


}