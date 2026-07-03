import { Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { TrendyolController } from './trendyol.controller'
import { TrendyolService } from './trendyol.service'
import { PrismaModule } from '../prisma.module'
import { MessagesModule } from '../messages/messages.module'
import { OrdersModule } from '../orders/orders.module'

@Module({
  imports: [HttpModule, PrismaModule, MessagesModule, OrdersModule],
  controllers: [TrendyolController],
  providers: [TrendyolService],
  exports: [TrendyolService],
})
export class TrendyolModule {}