import { Injectable, Logger } from '@nestjs/common'
import * as soap from 'soap'
import { randomUUID, createHash } from 'crypto'
import * as zlib from 'zlib'
import { SendInvoiceRequest, SendInvoiceResponse } from '../types'

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

      const invoiceId = this.generateInvoiceId(serie)
      const uuid = randomUUID().toUpperCase()
      const ublXml = this.buildUblInvoice(req, cred, invoiceId, uuid, profileId)

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
            vkn: this.getCustomerId(req),
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
            vkn: this.getCustomerId(req),
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

  private getCustomerId(req: SendInvoiceRequest): string {
    return req.customer.vkn || req.customer.tckn || '11111111111'
  }

  private getSchemeId(taxNumber: string): string {
    return taxNumber && taxNumber.length > 10 ? 'TCKN' : 'VKN'
  }

  private generateInvoiceId(serie: string): string {
    const year = new Date().getFullYear().toString()
    const serial = String(Math.floor(Math.random() * 999999999) + 1).padStart(9, '0')
    return `${serie}${year}${serial}`
  }

  private escapeXml(str: string): string {
    if (!str) return ''
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
  }

  private buildUblInvoice(req: SendInvoiceRequest, cred: IzibizCredentials, invoiceId: string, uuid: string, profileId: string): string {
    const now = new Date()
    const issueDate = req.issueDate || now.toISOString().slice(0, 10)
    const issueTime = now.toTimeString().slice(0, 8)

    const totalBeforeTax = req.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0)

    const taxLines = req.lines.map(l => {
      const vat = l.vatRate ?? 0
      const lineTotal = l.quantity * l.unitPrice
      const taxAmount = lineTotal * vat / 100
      return { lineTotal, taxAmount, vatRate: vat, name: l.name, qty: l.quantity, price: l.unitPrice }
    })

    const kdvTotal = taxLines.reduce((s, t) => s + t.taxAmount, 0)
    const payableAmount = totalBeforeTax + kdvTotal

    const customerId = this.getCustomerId(req)
    const customerSchemeId = this.getSchemeId(customerId)
    const supplierSchemeId = this.getSchemeId(cred.companyTaxNumber || '')

    const paymentCode = req.type === 'archive' ? '' : '48'

    const invoiceLinesXml = req.lines.map((line, i) => {
      const lineTotal = line.quantity * line.unitPrice
      const vatRate = line.vatRate ?? 0
      const lineTax = lineTotal * vatRate / 100
      return `
      <cac:InvoiceLine>
        <cbc:ID>${i + 1}</cbc:ID>
        <cbc:InvoicedQuantity unitCode="NIU">${line.quantity}</cbc:InvoicedQuantity>
        <cbc:LineExtensionAmount currencyID="TRY">${lineTotal.toFixed(2)}</cbc:LineExtensionAmount>
        <cac:AllowanceCharge>
          <cbc:ChargeIndicator>false</cbc:ChargeIndicator>
          <cbc:MultiplierFactorNumeric>0.0</cbc:MultiplierFactorNumeric>
          <cbc:Amount currencyID="TRY">0</cbc:Amount>
          <cbc:BaseAmount currencyID="TRY">${lineTotal.toFixed(2)}</cbc:BaseAmount>
        </cac:AllowanceCharge>
        <cac:TaxTotal>
          <cbc:TaxAmount currencyID="TRY">${lineTax.toFixed(2)}</cbc:TaxAmount>
          <cac:TaxSubtotal>
            <cbc:TaxableAmount currencyID="TRY">${lineTotal.toFixed(2)}</cbc:TaxableAmount>
            <cbc:TaxAmount currencyID="TRY">${lineTax.toFixed(2)}</cbc:TaxAmount>
            <cbc:Percent>${vatRate}</cbc:Percent>
            <cac:TaxCategory>
              <cac:TaxScheme>
                <cbc:Name>KDV</cbc:Name>
                <cbc:TaxTypeCode>0015</cbc:TaxTypeCode>
              </cac:TaxScheme>
            </cac:TaxCategory>
          </cac:TaxSubtotal>
        </cac:TaxTotal>
        <cac:Item>
          <cbc:Name>${this.escapeXml(line.name)}</cbc:Name>
        </cac:Item>
        <cac:Price>
          <cbc:PriceAmount currencyID="TRY">${line.unitPrice.toFixed(2)}</cbc:PriceAmount>
        </cac:Price>
      </cac:InvoiceLine>`
    }).join('')

    const supplierName = this.escapeXml(cred.companyName || '')
    const supplierTaxOffice = this.escapeXml(cred.companyTaxOffice || '')
    const supplierAddress = this.escapeXml(cred.companyAddress || '')
    const supplierCity = this.escapeXml(cred.companyCity || '')
    const customerName = this.escapeXml(req.customer.name || '')
    const customerAddress = this.escapeXml(req.customer.address || '')
    const customerEmail = this.escapeXml(req.customer.email || '')
    const customerPhone = this.escapeXml(req.customer.phone || '')

    const salesPlatform = req.salesPlatform === 'INTERNET' ? 'INTERNET' : 'NORMAL'

    return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
         xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2 UBL-Invoice-2.1.xsd">
  <ext:UBLExtensions>
    <ext:UBLExtension>
      <ext:ExtensionContent/>
    </ext:UBLExtension>
  </ext:UBLExtensions>
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>TR1.2</cbc:CustomizationID>
  <cbc:ProfileID>${profileId}</cbc:ProfileID>
  <cbc:ID>${invoiceId}</cbc:ID>
  <cbc:CopyIndicator>false</cbc:CopyIndicator>
  <cbc:UUID>${uuid}</cbc:UUID>
  <cbc:IssueDate>${issueDate}</cbc:IssueDate>
  <cbc:IssueTime>${issueTime}</cbc:IssueTime>
  <cbc:InvoiceTypeCode>SATIS</cbc:InvoiceTypeCode>
  <cbc:Note>${this.escapeXml(req.description || '')}</cbc:Note>
  <cbc:DocumentCurrencyCode>TRY</cbc:DocumentCurrencyCode>
  <cbc:LineCountNumeric>${req.lines.length}</cbc:LineCountNumeric>
  <cac:AdditionalDocumentReference>
    <cbc:ID>${uuid}</cbc:ID>
    <cbc:IssueDate>${issueDate}</cbc:IssueDate>
    <cbc:DocumentType>XSLT</cbc:DocumentType>
    <cac:Attachment>
      <cbc:EmbeddedDocumentBinaryObject mimeCode="application/xml" encodingCode="Base64" characterSetCode="UTF-8" filename="${invoiceId}.xslt">${this.getXsltBase64()}</cbc:EmbeddedDocumentBinaryObject>
    </cac:Attachment>
  </cac:AdditionalDocumentReference>
  <cac:Signature>
    <cbc:ID>${uuid}</cbc:ID>
    <cac:SignatoryParty>
      <cac:PartyIdentification>
        <cbc:ID schemeID="${supplierSchemeId}">${this.escapeXml(cred.companyTaxNumber || '')}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyName>
        <cbc:Name>${supplierName}</cbc:Name>
      </cac:PartyName>
    </cac:SignatoryParty>
    <cac:DigitalSignatureAttachment>
      <cac:ExternalReference>
        <cbc:URI>#${uuid}</cbc:URI>
      </cac:ExternalReference>
    </cac:DigitalSignatureAttachment>
  </cac:Signature>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cbc:WebsiteURI>https://bruskapp.com</cbc:WebsiteURI>
      <cac:PartyIdentification>
        <cbc:ID schemeID="${supplierSchemeId}">${this.escapeXml(cred.companyTaxNumber || '')}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyName>
        <cbc:Name>${supplierName}</cbc:Name>
      </cac:PartyName>
      <cac:PostalAddress>
        <cbc:ID>1</cbc:ID>
        <cbc:StreetName>${supplierAddress || 'N/A'}</cbc:StreetName>
        <cbc:BuildingNumber>N/A</cbc:BuildingNumber>
        <cbc:CitySubdivisionName>${supplierCity || 'N/A'}</cbc:CitySubdivisionName>
        <cbc:CityName>${supplierCity || 'N/A'}</cbc:CityName>
        <cbc:PostalZone>34000</cbc:PostalZone>
        <cac:Country>
          <cbc:Name>Türkiye</cbc:Name>
        </cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cac:TaxScheme>
          <cbc:Name>${supplierTaxOffice || 'N/A'}</cbc:Name>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:Contact>
        <cbc:Telephone>${this.escapeXml(cred.phone || 'N/A')}</cbc:Telephone>
        <cbc:ElectronicMail>${this.escapeXml(cred.email || 'N/A')}</cbc:ElectronicMail>
      </cac:Contact>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cbc:WebsiteURI></cbc:WebsiteURI>
      <cac:PartyIdentification>
        <cbc:ID schemeID="${customerSchemeId}">${this.escapeXml(customerId)}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyName>
        <cbc:Name>${customerName}</cbc:Name>
      </cac:PartyName>
      <cac:PostalAddress>
        <cbc:ID>1</cbc:ID>
        <cbc:StreetName>${customerAddress || 'N/A'}</cbc:StreetName>
        <cbc:BuildingNumber>N/A</cbc:BuildingNumber>
        <cbc:CitySubdivisionName>N/A</cbc:CitySubdivisionName>
        <cbc:CityName>N/A</cbc:CityName>
        <cbc:PostalZone>34000</cbc:PostalZone>
        <cac:Country>
          <cbc:Name>Türkiye</cbc:Name>
        </cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cac:TaxScheme>
          <cbc:Name>${this.escapeXml(req.customer.taxOffice || 'N/A')}</cbc:Name>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:Contact>
        <cbc:Telephone>${customerPhone || 'N/A'}</cbc:Telephone>
        <cbc:ElectronicMail>${customerEmail || 'N/A'}</cbc:ElectronicMail>
      </cac:Contact>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:PaymentMeans>
    <cbc:PaymentMeansCode>${paymentCode}</cbc:PaymentMeansCode>
  </cac:PaymentMeans>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="TRY">${kdvTotal.toFixed(2)}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="TRY">${totalBeforeTax.toFixed(2)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="TRY">${kdvTotal.toFixed(2)}</cbc:TaxAmount>
      <cbc:Percent>${req.lines[0]?.vatRate || 0}</cbc:Percent>
      <cac:TaxCategory>
        <cac:TaxScheme>
          <cbc:Name>KDV</cbc:Name>
          <cbc:TaxTypeCode>0015</cbc:TaxTypeCode>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="TRY">${totalBeforeTax.toFixed(2)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="TRY">${totalBeforeTax.toFixed(2)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="TRY">${payableAmount.toFixed(2)}</cbc:TaxInclusiveAmount>
    <cbc:AllowanceTotalAmount currencyID="TRY">0</cbc:AllowanceTotalAmount>
    <cbc:PayableAmount currencyID="TRY">${payableAmount.toFixed(2)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  ${invoiceLinesXml}
</Invoice>`
  }

  private getXsltBase64(): string {
    const xslt = `<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:template match="/">
    <html>
      <body>
        <h2>Fatura</h2>
        <p><b>Fatura No:</b> <xsl:value-of select="//cbc:ID"/></p>
        <p><b>Tarih:</b> <xsl:value-of select="//cbc:IssueDate"/></p>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>`
    return Buffer.from(xslt, 'utf-8').toString('base64')
  }
}
