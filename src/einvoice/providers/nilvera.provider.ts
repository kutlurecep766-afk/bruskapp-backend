import { Injectable, Logger } from '@nestjs/common'
import axios from 'axios'
import { randomUUID } from 'crypto'
import { SendInvoiceRequest, SendInvoiceResponse } from '../types'

interface NilveraConfig {
  apiKey: string
  testMode?: boolean
  templateUuid?: string
  invoiceSerie?: string
  companyTaxNumber?: string
  companyName?: string
  companyTaxOffice?: string
  companyAddress?: string
  companyCity?: string
}

@Injectable()
export class NilveraProvider {
  private readonly logger = new Logger(NilveraProvider.name)

  getBaseUrl(testMode: boolean): string {
    return testMode ? 'https://apitest.nilvera.com' : 'https://api.nilvera.com'
  }

  getHeaders(apiKey: string) {
    return {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    }
  }

  async testConnection(credentials: Record<string, string>): Promise<{ success: boolean; error?: string }> {
    try {
      const apiKey = credentials.apiKey
      const testMode = credentials.testMode !== 'false'
      const baseUrl = this.getBaseUrl(testMode)
      const headers = this.getHeaders(apiKey)

      const res = await axios.get(`${baseUrl}/general/Company`, { headers, timeout: 10000 })
      const company = res.data
      return {
        success: true,
        ...(company.Name ? { companyName: company.Name } : {}),
        ...(company.TaxNumber ? { companyTaxNumber: company.TaxNumber } : {}),
      }
    } catch (err: any) {
      this.logger.error(`Nilvera testConnection failed: ${err.message}`)
      const msg = err.response?.data?.Message || err.response?.data || err.message
      return { success: false, error: String(msg) }
    }
  }

  async fetchTemplates(credentials: Record<string, string>): Promise<{ success: boolean; templates?: any[]; error?: string }> {
    try {
      const apiKey = credentials.apiKey
      const testMode = credentials.testMode !== 'false'
      const baseUrl = this.getBaseUrl(testMode)
      const headers = this.getHeaders(apiKey)

      const res = await axios.get(`${baseUrl}/einvoice/Templates`, { headers, timeout: 10000 })
      return { success: true, templates: res.data?.Content || [] }
    } catch (err: any) {
      this.logger.error(`Nilvera fetchTemplates failed: ${err.message}`)
      return { success: false, error: String(err.response?.data?.Message || err.message) }
    }
  }

  async sendInvoice(credentials: Record<string, string>, req: SendInvoiceRequest): Promise<SendInvoiceResponse> {
    try {
      const config: NilveraConfig = {
        apiKey: credentials.apiKey,
        testMode: credentials.testMode !== 'false',
        templateUuid: credentials.templateUuid,
        invoiceSerie: credentials.invoiceSerie || 'EFT',
        companyTaxNumber: credentials.companyTaxNumber,
        companyName: credentials.companyName,
        companyTaxOffice: credentials.companyTaxOffice,
        companyAddress: credentials.companyAddress,
        companyCity: credentials.companyCity,
      }
      const baseUrl = this.getBaseUrl(config.testMode!)
      const headers = this.getHeaders(config.apiKey)

      const now = new Date().toISOString()
      const totalBeforeTax = req.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0)
      const kdvTotal = req.lines.reduce((s, l) => {
        const vat = l.vatRate ?? 0
        return s + l.quantity * l.unitPrice * vat / 100
      }, 0)
      const payable = totalBeforeTax + kdvTotal

      const invoiceLines = req.lines.map((line, i) => ({
        Index: String(i + 1),
        Name: line.name,
        Quantity: line.quantity,
        UnitType: 'C62',
        Price: line.unitPrice,
        AllowanceTotal: 0,
        KDVPercent: line.vatRate ?? 0,
        KDVTotal: 0,
      }))

      const customerTaxNumber = req.customer.vkn || req.customer.tckn || '11111111111'
      const customerName = req.customer.name

      if (req.type === 'archive') {
        const body = {
          ArchiveInvoice: {
            InvoiceInfo: {
              UUID: randomUUID(),
              TemplateUUID: config.templateUuid || '00000000-0000-0000-0000-000000000000',
              InvoiceType: 'SATIS',
              IssueDate: req.issueDate || now,
              CurrencyCode: 'TRY',
              SalesPlatform: 'INTERNET',
              SendType: 'ELEKTRONIK',
              LineExtensionAmount: totalBeforeTax,
              PayableAmount: payable,
              KdvTotal: kdvTotal,
            },
            CompanyInfo: {
              TaxNumber: config.companyTaxNumber || '',
              Name: config.companyName || '',
              TaxOffice: config.companyTaxOffice || '',
              Address: config.companyAddress || '',
              City: config.companyCity || '',
              Country: 'Türkiye',
            },
            CustomerInfo: {
              TaxNumber: customerTaxNumber,
              Name: customerName,
              Address: req.customer.address || '',
              City: '',
              Country: 'Türkiye',
              Mail: req.customer.email || '',
              Phone: req.customer.phone || '',
            },
            InvoiceLines: invoiceLines,
            Notes: req.description ? [req.description] : [],
          },
        }

        const res = await axios.post(`${baseUrl}/earchive/Send/Model`, body, { headers, timeout: 30000 })
        const data = res.data
        return {
          success: true,
          uuid: data.uuid || data.UUID,
          invoiceNumber: data.invoiceNumber || data.InvoiceNumber,
        }
      } else {
        const body = {
          EInvoice: {
            InvoiceInfo: {
              UUID: randomUUID(),
              TemplateUUID: config.templateUuid || '00000000-0000-0000-0000-000000000000',
              InvoiceType: 'SATIS',
              InvoiceSerieOrNumber: config.invoiceSerie,
              IssueDate: req.issueDate || now,
              CurrencyCode: 'TRY',
              InvoiceProfile: 'TICARIFATURA',
              LineExtensionAmount: totalBeforeTax,
              PayableAmount: payable,
              KdvTotal: kdvTotal,
            },
            CompanyInfo: {
              TaxNumber: config.companyTaxNumber || '',
              Name: config.companyName || '',
              TaxOffice: config.companyTaxOffice || '',
              Address: config.companyAddress || '',
              City: config.companyCity || '',
              Country: 'Türkiye',
            },
            CustomerInfo: {
              TaxNumber: customerTaxNumber,
              Name: customerName,
              TaxOffice: req.customer.taxOffice || '',
              Address: req.customer.address || '',
              City: '',
              Country: 'Türkiye',
              Mail: req.customer.email || '',
              Phone: req.customer.phone || '',
            },
            InvoiceLines: invoiceLines,
            Notes: req.description ? [req.description] : [],
          },
        }

        const res = await axios.post(`${baseUrl}/einvoice/Send/Model`, body, { headers, timeout: 30000 })
        const data = res.data
        return {
          success: true,
          uuid: data.uuid || data.UUID,
          invoiceNumber: data.invoiceNumber || data.InvoiceNumber,
        }
      }
    } catch (err: any) {
      this.logger.error(`Nilvera sendInvoice failed: ${err.message}`)
      const msg = err.response?.data?.Message || err.response?.data || err.message
      return { success: false, error: String(msg) }
    }
  }
}
