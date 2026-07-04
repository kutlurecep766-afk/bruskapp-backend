import { Injectable, Logger } from '@nestjs/common'
import * as soap from 'soap'
import { randomUUID } from 'crypto'
import { SendInvoiceRequest, SendInvoiceResponse } from '../types'
import { buildUblInvoice, generateInvoiceId } from '../ubl-transformer'

interface EdmCredentials {
  username: string
  password: string
  testMode?: string
  companyTaxNumber?: string
  companyName?: string
  companyTaxOffice?: string
  companyAddress?: string
  companyCity?: string
  invoiceSerie?: string
  archiveSerie?: string
  phone?: string
  email?: string
}

@Injectable()
export class EdmProvider {
  private readonly logger = new Logger(EdmProvider.name)

  private getUrls(testMode: boolean) {
    const base = testMode
      ? 'https://test.edmbilisim.com.tr/EFaturaEDM21ea'
      : 'https://efatura.edmbilisim.com.tr/EFaturaEDM21ea'
    return {
      wsdl: `${base}/EFaturaEDM.svc?singleWsdl`,
      address: `${base}/EFaturaEDM.svc`,
    }
  }

  private async login(urls: { wsdl: string; address: string }, cred: EdmCredentials): Promise<string> {
    const client = await soap.createClientAsync(urls.wsdl, { wsdl_options: { timeout: 15000 }, endpoint: urls.address })
    const now = new Date().toISOString().replace(/\.\d{3}Z$/, '')
    const params = {
      REQUEST_HEADER: {
        SESSION_ID: '',
        CLIENT_TXN_ID: randomUUID().toUpperCase(),
        ACTION_DATE: now,
        REASON: 'Fatura Gonderme',
        HOSTNAME: 'bruskapp',
        CHANNEL_NAME: 'bruskapp',
        APPLICATION_NAME: 'bruskapp',
        COMPRESSED: 'N',
      },
      USER_NAME: cred.username,
      PASSWORD: cred.password,
    }
    const [result] = await client.LoginAsync(params)
    const sessionId = result?.SESSION_ID
    if (!sessionId) throw new Error('EDM oturum açılamadı')
    return sessionId
  }

  async testConnection(credentials: Record<string, string>): Promise<{ success: boolean; error?: string }> {
    try {
      const cred = credentials as unknown as EdmCredentials
      const urls = this.getUrls(cred.testMode !== 'false')
      const sessionId = await this.login(urls, cred)
      return sessionId ? { success: true } : { success: false, error: 'EDM oturum açılamadı' }
    } catch (err: any) {
      this.logger.error(`EDM testConnection failed: ${err.message}`)
      const detail = err.root?.Envelope?.Body?.Fault?.faultstring || err.message
      return { success: false, error: `EDM bağlantı hatası: ${detail}` }
    }
  }

  async sendInvoice(credentials: Record<string, string>, req: SendInvoiceRequest): Promise<SendInvoiceResponse> {
    try {
      const cred = credentials as unknown as EdmCredentials
      const testMode = cred.testMode !== 'false'
      const urls = this.getUrls(testMode)
      const client = await soap.createClientAsync(urls.wsdl, { wsdl_options: { timeout: 30000 }, endpoint: urls.address })
      const sessionId = await this.login(urls, cred)

      const uuid = randomUUID().toUpperCase()
      const serie = req.type === 'archive' ? (cred.archiveSerie || 'EDM') : (cred.invoiceSerie || 'EDM')
      const invoiceId = generateInvoiceId(serie)
      const profileId = req.type === 'archive' ? 'EARSIVFATURA' : 'TICARIFATURA'
      const ublXml = buildUblInvoice(req, {
        profileId,
        invoiceId,
        uuid,
        companyTaxNumber: cred.companyTaxNumber || '',
        companyName: cred.companyName,
        companyTaxOffice: cred.companyTaxOffice,
        companyAddress: cred.companyAddress,
        companyCity: cred.companyCity,
        phone: cred.phone,
        email: cred.email,
        includeSignature: true,
      })

      const base64Content = Buffer.from(ublXml, 'utf-8').toString('base64')

      const params = {
        REQUEST_HEADER: {
          SESSION_ID: sessionId,
          COMPRESSED: 'N',
          APPLICATION_NAME: 'bruskapp',
          CHANNEL_NAME: 'bruskapp',
        },
        SENDER: {
          vkn: cred.companyTaxNumber || '',
          alias: '',
        },
        RECEIVER: {
          vkn: req.customer.vkn || req.customer.tckn || '11111111111',
          alias: '',
        },
        INVOICE: {
          CONTENT: base64Content,
        },
      }

      const [result] = await client.SendInvoiceAsync(params)

      if (result?.ERROR_TYPE) {
        return {
          success: false,
          error: `EDM hata: ${result.ERROR_TYPE.ERROR_SHORT_DESC || result.ERROR_TYPE.ERROR_CODE || 'Bilinmeyen hata'}`,
        }
      }

      return {
        success: true,
        uuid,
        invoiceNumber: result?.REQUEST_RETURN?.INVOICE_ID || invoiceId,
        status: String(result?.REQUEST_RETURN?.RETURN_CODE || ''),
      }
    } catch (err: any) {
      this.logger.error(`EDM sendInvoice failed: ${err.message}`)
      const detail = err.root?.Envelope?.Body?.Fault?.faultstring || err.message
      return { success: false, error: `EDM gönderme hatası: ${detail}` }
    }
  }

}