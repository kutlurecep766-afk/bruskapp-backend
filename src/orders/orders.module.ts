import { Module } from '@nestjs/common'
import { OrdersController } from './orders.controller'
import { OrdersService } from './orders.service'
import { PrinterModule } from '../printer/printer.module'
import { NotificationsModule } from '../notifications/notifications.module'
import { EInvoiceModule } from '../einvoice/einvoice.module'

@Module({
  imports: [PrinterModule, NotificationsModule, EInvoiceModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
