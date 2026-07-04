import { Injectable, Logger } from '@nestjs/common'
import * as soap from 'soap'
import { randomUUID } from 'crypto'
import { SendInvoiceRequest, SendInvoiceResponse } from '../types'
import { buildUblInvoice, generateInvoiceId } from '../ubl-transformer'

interface IzibizCredentials {
  username: string
  password: string
  testMode?: string
  companyTaxNumber?: string
  companyName?: string
  companyTaxOffice?: string
  companyAddress?: string
  companyCity?: string
  senderAlias?: string
  receiverAlias?: string
  invoiceSerie?: string
  archiveSerie?: string
  phone?: string
  email?: string
}

@Injectable()
export class IzibizProvider {
  private readonly logger = new Logger(IzibizProvider.name)

  private getBaseUrl(testMode: boolean): string {
    return testMode ? 'https://efaturatest.izibiz.com.tr' : 'https://efatura.izibiz.com.tr'
  }

  private getUrls(testMode: boolean) {
    const base = this.getBaseUrl(testMode)
    return {
      auth: `${base}/AuthenticationWS?wsdl`,
      einvoice: `${base}/EInvoiceWS?wsdl`,
      earchive: `${base}/EIArchiveWS/EFaturaArchive?wsdl`,
    }
  }

  private async login(urls: { auth: string }, cred: IzibizCredentials): Promise<string> {
    const client = await soap.createClientAsync(urls.auth, { wsdl_options: { timeout: 15000 } })
    const params = {
      REQUEST_HEADER: { SESSION_ID: '' },
      USER_NAME: cred.username,
      PASSWORD: cred.password,
    }
    const [result] = await client.LoginAsync(params)
    const sessionId = result?.SESSION_ID
    if (!sessionId) throw new Error('İzibiz oturum açılamadı')
    return sessionId
  }

  private async testLogin(cred: IzibizCredentials): Promise<boolean> {
    try {
      const urls = this.getUrls(cred.testMode !== 'false')
      const sessionId = await this.login(urls, cred)
      return !!sessionId
    } catch {
      return false
    }
  }

  async testConnection(credentials: Record<string, string>): Promise<{ success: boolean; error?: string }> {
    try {
      const cred = credentials as unknown as IzibizCredentials
      const ok = await this.testLogin(cred)
      return ok
        ? { success: true }
        : { success: false, error: 'İzibiz kullanıcı adı veya şifre hatalı' }
    } catch (err: any) {
      this.logger.error(`İzibiz testConnection failed: ${err.message}`)
      return { success: false, error: err.message }
    }
  }

  async checkUser(credentials: Record<string, string>, taxNumber: string): Promise<{ registered: boolean; error?: string }> {
    try {
      const cred = credentials as unknown as IzibizCredentials
      const testMode = cred.testMode !== 'false'
      const urls = this.getUrls(testMode)
      const sessionId = await this.login(urls, cred)
      const client = await soap.createClientAsync(urls.einvoice, { wsdl_options: { timeout: 15000 } })
      const [result] = await client.CheckUserAsync({
        REQUEST_HEADER: { SESSION_ID: sessionId, APPLICATION_NAME: 'bruskapp' },
        USER: { IDENTIFIER: taxNumber },
        DOCUMENT_TYPE: 'INVOICE',
      })
      const users = result?.USER
      const registered = users && (Array.isArray(users) ? users.length > 0 : true)
      return { registered: !!registered }
    } catch (err: any) {
      this.logger.error(`İzibiz checkUser failed: ${err.message}`)
      return { registered: false, error: 'Mükellef sorgulanamadı' }
    }
  }

  async sendInvoice(credentials: Record<string, string>, req: SendInvoiceRequest): Promise<SendInvoiceResponse> {
    try {
      const cred = credentials as unknown as IzibizCredentials
      const testMode = cred.testMode !== 'false'
      const urls = this.getUrls(testMode)
      const sessionId = await this.login(urls, cred)

      const profileId = req.type === 'archive' ? 'EARSIVFATURA' : 'TICARIFATURA'
      const serie = req.type === 'archive'
        ? (cred.archiveSerie || 'EAR')
        : (cred.invoiceSerie || 'IZI')

      const invoiceId = generateInvoiceId(serie)
      const uuid = randomUUID().toUpperCase()
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
        includeXslt: true,
      })

      const compressed = Buffer.from(ublXml, 'utf-8')
      const base64Content = compressed.toString('base64')

      if (req.type === 'archive') {
        const client = await soap.createClientAsync(urls.earchive, { wsdl_options: { timeout: 30000 } })

        const params = {
          REQUEST_HEADER: {
            SESSION_ID: sessionId,
            COMPRESSED: 'N',
            APPLICATION_NAME: 'bruskapp.Application',
          },
          SENDER: {
            vkn: cred.companyTaxNumber || '',
            alias: cred.senderAlias || 'urn:mail:defaultgb@izibiz.com.tr',
          },
          RECEIVER: {
            vkn: req.customer.vkn || req.customer.tckn || '11111111111',
            alias: cred.receiverAlias || '',
          },
          INVOICE: {
            CONTENT: base64Content,
          },
        }

        const [result] = await client.SendInvoiceWithServerSignAsync(params)

        if (result?.ERROR_TYPE) {
          return {
            success: false,
            error: `İzibiz hata: ${result.ERROR_TYPE.ERROR_SHORT_DESC || result.ERROR_TYPE.ERROR_CODE || 'Bilinmeyen hata'}`,
          }
        }

        return {
          success: true,
          uuid: uuid,
          invoiceNumber: result?.REQUEST_RETURN?.INVOICE_ID || invoiceId,
          status: String(result?.REQUEST_RETURN?.RETURN_CODE || ''),
        }
      } else {
        const client = await soap.createClientAsync(urls.einvoice, { wsdl_options: { timeout: 30000 } })

        const params = {
          REQUEST_HEADER: {
            SESSION_ID: sessionId,
            COMPRESSED: 'N',
            APPLICATION_NAME: 'bruskapp.Application',
          },
          SENDER: {
            vkn: cred.companyTaxNumber || '',
            alias: cred.senderAlias || 'urn:mail:defaultgb@izibiz.com.tr',
          },
          RECEIVER: {
            vkn: req.customer.vkn || req.customer.tckn || '11111111111',
            alias: cred.receiverAlias || '',
          },
          INVOICE: {
            CONTENT: base64Content,
          },
        }

        const [result] = await client.SendInvoiceAsync(params)

        if (result?.ERROR_TYPE) {
          return {
            success: false,
            error: `İzibiz hata: ${result.ERROR_TYPE.ERROR_SHORT_DESC || result.ERROR_TYPE.ERROR_CODE || 'Bilinmeyen hata'}`,
          }
        }

        return {
          success: true,
          uuid: uuid,
          invoiceNumber: invoiceId,
          status: String(result?.REQUEST_RETURN?.RETURN_CODE || ''),
        }
      }
    } catch (err: any) {
      this.logger.error(`İzibiz sendInvoice failed: ${err.message}`)
      const detail = err.root?.Envelope?.Body?.Fault?.faultstring || err.message
      return { success: false, error: String(detail) }
    }
  }

}
