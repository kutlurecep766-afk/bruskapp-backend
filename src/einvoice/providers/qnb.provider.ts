import { Injectable, Logger } from '@nestjs/common'
import * as soap from 'soap'
import { randomUUID, createHash } from 'crypto'
import { SendInvoiceRequest, SendInvoiceResponse } from '../types'

interface QnbCredentials {
  username: string
  password: string
  companyTaxNumber?: string
  testMode?: string
  sube?: string
  kasa?: string
  invoiceSerie?: string
  companyName?: string
  companyTaxOffice?: string
  companyAddress?: string
  companyCity?: string
  phone?: string
  email?: string
}

@Injectable()
export class QnbProvider {
  private readonly logger = new Logger(QnbProvider.name)

  private getUrls(testMode: boolean) {
    return {
      efatura: testMode
        ? 'https://erpefaturatest.cs.com.tr:8443/efatura/ws/connectorService?wsdl'
        : 'https://erpefatura.cs.com.tr:8443/efatura/ws/connectorService?wsdl',
      earsiv: testMode
        ? 'https://earsivtest.efinans.com.tr/earsiv/ws/EarsivWebService?wsdl'
        : 'https://earsiv.efinans.com.tr/earsiv/ws/EarsivWebService?wsdl',
    }
  }

  private getSchemeId(taxNumber: string): string {
    return taxNumber && taxNumber.length > 10 ? 'TCKN' : 'VKN'
  }

  private buildUblInvoice(req: SendInvoiceRequest, cred: QnbCredentials): string {
    const uuid = randomUUID().toUpperCase()
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

    const customerId = req.customer.vkn || req.customer.tckn || '11111111111'
    const customerSchemeId = this.getSchemeId(customerId)
    const supplierSchemeId = this.getSchemeId(cred.companyTaxNumber || '')

    const profileId = req.type === 'archive' ? 'EARSIVFATURA' : 'TICARIFATURA'

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

    const notesXml = req.type === 'archive'
      ? `<cbc:Note>Gönderim Şekli: ELEKTRONIK</cbc:Note>`
      : ''

    const supplierName = this.escapeXml(cred.companyName || '')
    const supplierTaxOffice = this.escapeXml(cred.companyTaxOffice || '')
    const supplierAddress = this.escapeXml(cred.companyAddress || '')
    const supplierCity = this.escapeXml(cred.companyCity || '')

    const customerName = this.escapeXml(req.customer.name || '')
    const customerAddress = this.escapeXml(req.customer.address || '')
    const customerEmail = this.escapeXml(req.customer.email || '')
    const customerPhone = this.escapeXml(req.customer.phone || '')
    const customerVkn = this.escapeXml(customerId)

    return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
         xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2 ../xsdrt/maindoc/UBL-Invoice-2.1.xsd">
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>TR1.2</cbc:CustomizationID>
  <cbc:ProfileID>${profileId}</cbc:ProfileID>
  <cbc:ID></cbc:ID>
  <cbc:CopyIndicator>false</cbc:CopyIndicator>
  <cbc:UUID>${uuid}</cbc:UUID>
  <cbc:IssueDate>${issueDate}</cbc:IssueDate>
  <cbc:IssueTime>${issueTime}</cbc:IssueTime>
  <cbc:InvoiceTypeCode>SATIS</cbc:InvoiceTypeCode>
  ${notesXml}
  <cbc:DocumentCurrencyCode>TRY</cbc:DocumentCurrencyCode>
  <cbc:LineCountNumeric>${req.lines.length}</cbc:LineCountNumeric>
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
        <cbc:ID schemeID="${customerSchemeId}">${customerVkn}</cbc:ID>
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
          <cbc:Name>${req.customer.taxOffice || 'N/A'}</cbc:Name>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:Contact>
        <cbc:Telephone>${customerPhone || 'N/A'}</cbc:Telephone>
        <cbc:ElectronicMail>${customerEmail || 'N/A'}</cbc:ElectronicMail>
      </cac:Contact>
    </cac:Party>
  </cac:AccountingCustomerParty>
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

  private escapeXml(str: string): string {
    if (!str) return ''
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
  }

  private async createSoapClient(url: string, username: string, password: string): Promise<soap.Client> {
    const client = await soap.createClientAsync(url, {
      wsdl_options: {
        timeout: 30000,
      },
    })
    client.setSecurity(new soap.WSSecurity(username, password, { passwordType: 'PasswordText' }))
    return client
  }

  async testConnection(credentials: Record<string, string>): Promise<{ success: boolean; error?: string }> {
    try {
      const cred = credentials as unknown as QnbCredentials
      const testMode = cred.testMode !== 'false'
      const urls = this.getUrls(testMode)

      const client = await this.createSoapClient(urls.efatura, cred.username, cred.password)

      const [result] = await client.efaturaKullanicisiAsync({ vergiTcKimlikNo: cred.companyTaxNumber })

      const isRegistered = Number(result?.return ?? result) === 1
      return {
        success: isRegistered,
        ...(isRegistered ? {} : { error: 'Vergi numarası QNB e-Fatura sisteminde kayıtlı değil' }),
      }
    } catch (err: any) {
      this.logger.error(`QNB testConnection failed: ${err.message}`)
      const detail = err.root?.Envelope?.Body?.Fault?.faultstring || err.message
      return { success: false, error: String(detail) }
    }
  }

  async sendInvoice(credentials: Record<string, string>, req: SendInvoiceRequest): Promise<SendInvoiceResponse> {
    try {
      const cred = credentials as unknown as QnbCredentials
      const testMode = cred.testMode !== 'false'
      const urls = this.getUrls(testMode)
      const sube = cred.sube || 'DFLT'
      const kasa = cred.kasa || 'DFLT'

      const ublXml = this.buildUblInvoice(req, cred)

      if (req.type === 'archive') {
        const client = await this.createSoapClient(urls.earsiv, cred.username, cred.password)

        const uuid = randomUUID().toUpperCase()
        const inputPayload = JSON.stringify({
          donenBelgeFormati: 9,
          islemId: uuid,
          vkn: cred.companyTaxNumber,
          sube,
          kasa,
          numaraVerilsinMi: 1,
          faturaSeri: cred.invoiceSerie || 'EA',
        })

        const [result] = await client.faturaOlusturAsync({
          input: inputPayload,
          fatura: {
            belgeFormati: 'UBL',
            belgeIcerigi: ublXml,
          },
        })

        const r = result?.return || result
        const resultCode = r?.resultCode || ''
        const isSuccess = resultCode === 'AE00000'

        let entry: any = {}
        if (r?.resultExtra?.entry) {
          const e = r.resultExtra.entry
          entry = Array.isArray(e) ? e.reduce((acc: any, item: any) => {
            if (item?.key) acc[item.key] = item.value || item.$value
            return acc
          }, {}) : { faturaURL: e, uuid: uuid }
        }

        return {
          success: isSuccess,
          uuid: entry.uuid || uuid,
          invoiceNumber: entry.faturaNo || '',
          status: resultCode,
          ...(isSuccess ? {} : { error: r?.resultText || 'Bilinmeyen hata' }),
        }
      } else {
        const client = await this.createSoapClient(urls.efatura, cred.username, cred.password)

        const belgeNo = randomUUID().replace(/-/g, '').substring(0, 20)
        const belgeHash = createHash('md5').update(ublXml).digest('hex')

        const [result] = await client.belgeGonderAsync({
          vergiTcKimlikNo: cred.companyTaxNumber,
          belgeTuru: 'FATURA_UBL',
          belgeNo,
          veri: ublXml,
          belgeHash,
          mimeType: 'application/xml',
          belgeVersiyon: '3.0',
        })

        const belgeOid = result?.return?.belgeOid || result?.belgeOid || ''
        return {
          success: !!belgeOid,
          uuid: belgeOid,
          invoiceNumber: '',
          status: belgeOid ? 'GÖNDERİLDİ' : 'HATA',
          ...(belgeOid ? {} : { error: 'e-Fatura gönderilemedi' }),
        }
      }
    } catch (err: any) {
      this.logger.error(`QNB sendInvoice failed: ${err.message}`)
      const detail = err.root?.Envelope?.Body?.Fault?.faultstring || err.message
      return { success: false, error: String(detail) }
    }
  }
}
