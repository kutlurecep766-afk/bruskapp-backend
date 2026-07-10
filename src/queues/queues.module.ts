import { Global, Module } from '@nestjs/common'
import { BullModule } from '@nestjs/bullmq'
import { OrderProcessingProcessor } from './order-processing.processor'
import { EInvoiceModule } from '../einvoice/einvoice.module'
import { NotificationsModule } from '../notifications/notifications.module'

@Global()
@Module({
  imports: [
    BullModule.registerQueue({ name: 'order-processing' }),
    EInvoiceModule, NotificationsModule,
  ],
  providers: [OrderProcessingProcessor],
  exports: [BullModule],
})
export class QueuesModule {}
