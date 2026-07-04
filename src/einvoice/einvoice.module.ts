import { Module } from '@nestjs/common'
import { EInvoiceController } from './einvoice.controller'
import { EInvoiceService } from './einvoice.service'
import { NilveraProvider } from './providers/nilvera.provider'
import { IzibizProvider } from './providers/izibiz.provider'
import { EdmProvider } from './providers/edm.provider'
import { QnbProvider } from './providers/qnb.provider'

@Module({
  controllers: [EInvoiceController],
  providers: [EInvoiceService, NilveraProvider, IzibizProvider, EdmProvider, QnbProvider],
  exports: [EInvoiceService],
})
export class EInvoiceModule {}
