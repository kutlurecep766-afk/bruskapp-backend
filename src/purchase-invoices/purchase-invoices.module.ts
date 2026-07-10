import { Module } from '@nestjs/common'
import { PurchaseInvoicesController } from './purchase-invoices.controller'
import { PurchaseInvoicesService } from './purchase-invoices.service'
import { StockMovementsModule } from '../stock-movements/stock-movements.module'

@Module({
  imports: [StockMovementsModule],
  controllers: [PurchaseInvoicesController],
  providers: [PurchaseInvoicesService],
  exports: [PurchaseInvoicesService],
})
export class PurchaseInvoicesModule {}
