import { Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { HepsiburadaController } from './hepsiburada.controller'
import { HepsiburadaService } from './hepsiburada.service'
import { PrismaModule } from '../prisma.module'
import { MessagesModule } from '../messages/messages.module'
import { OrdersModule } from '../orders/orders.module'

@Module({
  imports: [HttpModule, PrismaModule, MessagesModule, OrdersModule],
  providers: [HepsiburadaService],
  exports: [HepsiburadaService],
})
export class HepsiburadaModule {}
