import { Module } from '@nestjs/common'
import { WebchatController } from './webchat.controller'
import { WebchatService } from './webchat.service'
import { TenantsModule } from '../tenants/tenants.module'
import { OrdersModule } from '../orders/orders.module'
import { AppointmentsModule } from '../appointments/appointments.module'
import { ReservationsModule } from '../reservations/reservations.module'

@Module({
  imports: [TenantsModule, OrdersModule, AppointmentsModule, ReservationsModule],
  controllers: [WebchatController],
  providers: [WebchatService],
  exports: [WebchatService],
})
export class WebchatModule {}
