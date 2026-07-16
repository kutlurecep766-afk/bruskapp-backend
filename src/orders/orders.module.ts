import { Module } from '@nestjs/common'
import { BullModule } from '@nestjs/bullmq'
import { OrdersController } from './orders.controller'
import { OrdersService } from './orders.service'

@Module({
  imports: [
    BullModule.registerQueue({ name: 'order-processing' }),
  ],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
