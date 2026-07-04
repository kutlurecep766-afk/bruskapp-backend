import { SendInvoiceRequest, EInvoiceLine } from './types'

export interface UblOptions {
  profileId: string
  invoiceId: string
  uuid: string
  companyTaxNumber: string
  companyName?: string
  companyTaxOffice?: string
  companyAddress?: string
  companyCity?: string
  phone?: string
  email?: string
  includeXslt?: boolean
  includePaymentMeans?: boolean
  includeSignature?: boolean
}

export function buildUblInvoice(req: SendInvoiceRequest, opts: UblOptions): string {
  const now = new Date()
  const issueDate = req.issueDate || now.toISOString().slice(0, 10)
  const issueTime = now.toTimeString().slice(0, 8)

  const totalBeforeTax = req.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0)
  const kdvTotal = req.lines.reduce((s, l) => {
    const vat = l.vatRate ?? 0
    return s + l.quantity * l.unitPrice * vat / 100
  }, 0)
  const payableAmount = totalBeforeTax + kdvTotal

  const customerId = req.customer.vkn || req.customer.tckn || '11111111111'
  const customerSchemeId = customerId.length > 10 ? 'TCKN' : 'VKN'
  const supplierSchemeId = (opts.companyTaxNumber || '').length > 10 ? 'TCKN' : 'VKN'

  const extraBlocks: string[] = []

  if (opts.includeXslt) {
    extraBlocks.push(`  <cac:AdditionalDocumentReference>
    <cbc:ID>${opts.uuid}</cbc:ID>
    <cbc:IssueDate>${issueDate}</cbc:IssueDate>
    <cbc:DocumentType>XSLT</cbc:DocumentType>
    <cac:Attachment>
      <cbc:EmbeddedDocumentBinaryObject mimeCode="application/xml" encodingCode="Base64" characterSetCode="UTF-8" filename="${opts.invoiceId}.xslt">${getXsltBase64()}</cbc:EmbeddedDocumentBinaryObject>
    </cac:Attachment>
  </cac:AdditionalDocumentReference>`)
  }

  if (opts.includeSignature) {
    extraBlocks.push(`  <cac:Signature>
    <cbc:ID>${opts.uuid}</cbc:ID>
    <cac:SignatoryParty>
      <cac:PartyIdentification>
        <cbc:ID schemeID="${supplierSchemeId}">${esc(opts.companyTaxNumber || '')}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyName>
        <cbc:Name>${esc(opts.companyName || '')}</cbc:Name>
      </cac:PartyName>
    </cac:SignatoryParty>
    <cac:DigitalSignatureAttachment>
      <cac:ExternalReference>
        <cbc:URI>#${opts.uuid}</cbc:URI>
      </cac:ExternalReference>
    </cac:DigitalSignatureAttachment>
  </cac:Signature>`)
  }

  if (opts.includePaymentMeans) {
    extraBlocks.push(`  <cac:PaymentMeans>
    <cbc:PaymentMeansCode>48</cbc:PaymentMeansCode>
  </cac:PaymentMeans>`)
  }

  const invoiceLinesXml = req.lines.map((line, i) => {
    const lineTotal = line.quantity * line.unitPrice
    const vatRate = line.vatRate ?? 0
    const lineTax = lineTotal * vatRate / 100
    return `  <cac:InvoiceLine>
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
      <cbc:Name>${esc(line.name)}</cbc:Name>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="TRY">${line.unitPrice.toFixed(2)}</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>`
  }).join('\n')

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
  <cbc:ProfileID>${opts.profileId}</cbc:ProfileID>
  <cbc:ID>${opts.invoiceId}</cbc:ID>
  <cbc:CopyIndicator>false</cbc:CopyIndicator>
  <cbc:UUID>${opts.uuid}</cbc:UUID>
  <cbc:IssueDate>${issueDate}</cbc:IssueDate>
  <cbc:IssueTime>${issueTime}</cbc:IssueTime>
  <cbc:InvoiceTypeCode>SATIS</cbc:InvoiceTypeCode>
  <cbc:Note>${esc(req.description || '')}</cbc:Note>
  <cbc:DocumentCurrencyCode>TRY</cbc:DocumentCurrencyCode>
  <cbc:LineCountNumeric>${req.lines.length}</cbc:LineCountNumeric>
${extraBlocks.join('\n')}
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cbc:WebsiteURI>https://bruskapp.com</cbc:WebsiteURI>
      <cac:PartyIdentification>
        <cbc:ID schemeID="${supplierSchemeId}">${esc(opts.companyTaxNumber || '')}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyName>
        <cbc:Name>${esc(opts.companyName || '')}</cbc:Name>
      </cac:PartyName>
      <cac:PostalAddress>
        <cbc:ID>1</cbc:ID>
        <cbc:StreetName>${esc(opts.companyAddress || 'N/A')}</cbc:StreetName>
        <cbc:BuildingNumber>N/A</cbc:BuildingNumber>
        <cbc:CitySubdivisionName>${esc(opts.companyCity || 'N/A')}</cbc:CitySubdivisionName>
        <cbc:CityName>${esc(opts.companyCity || 'N/A')}</cbc:CityName>
        <cbc:PostalZone>34000</cbc:PostalZone>
        <cac:Country>
          <cbc:Name>Türkiye</cbc:Name>
        </cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cac:TaxScheme>
          <cbc:Name>${esc(opts.companyTaxOffice || 'N/A')}</cbc:Name>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:Contact>
        <cbc:Telephone>${esc(opts.phone || 'N/A')}</cbc:Telephone>
        <cbc:ElectronicMail>${esc(opts.email || 'N/A')}</cbc:ElectronicMail>
      </cac:Contact>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cbc:WebsiteURI></cbc:WebsiteURI>
      <cac:PartyIdentification>
        <cbc:ID schemeID="${customerSchemeId}">${esc(customerId)}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyName>
        <cbc:Name>${esc(req.customer.name || '')}</cbc:Name>
      </cac:PartyName>
      <cac:PostalAddress>
        <cbc:ID>1</cbc:ID>
        <cbc:StreetName>${esc(req.customer.address || 'N/A')}</cbc:StreetName>
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
          <cbc:Name>${esc(req.customer.taxOffice || 'N/A')}</cbc:Name>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:Contact>
        <cbc:Telephone>${esc(req.customer.phone || 'N/A')}</cbc:Telephone>
        <cbc:ElectronicMail>${esc(req.customer.email || 'N/A')}</cbc:ElectronicMail>
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

function esc(str: string): string {
  if (!str) return ''
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

function getXsltBase64(): string {
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

export function generateInvoiceId(serie: string): string {
  const year = new Date().getFullYear().toString()
  const serial = String(Math.floor(Math.random() * 999999999) + 1).padStart(9, '0')
  return `${serie}${year}${serial}`
}
