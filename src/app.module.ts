import { Global, Module } from '@nestjs/common'
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler'
import { APP_GUARD } from '@nestjs/core'
import { BullModule } from '@nestjs/bullmq'
import { BullBoardModule } from '@bull-board/nestjs'
import { ExpressAdapter } from '@bull-board/express'
import { AppController } from './app.controller'
import { AppService } from './app.service'
import { UsersModule } from './users/users.module'
import { WhatsappModule } from './whatsapp/whatsapp.module'
import { TelegramModule } from './telegram/telegram.module'
import { InstagramModule } from './instagram/instagram.module'
import { PushModule } from './push/push.module'
import { OrdersModule } from './orders/orders.module'
import { NotificationsModule } from './notifications/notifications.module'
import { WebchatModule } from './webchat/webchat.module'
import { MessagesModule } from './messages/messages.module'
import { ConfigService } from './config.service'
import { AuthModule } from './auth/auth.module'
import { LeadModule } from './lead/lead.module'
import { SystemHealthModule } from './system-health/system-health.module'
import { PrismaModule } from './prisma.module'
import { TenantsModule } from './tenants/tenants.module'
import { ReportScheduleModule } from './report-schedule/report-schedule.module'
import { CommentsModule } from './comments/comments.module'
import { ReminderTemplatesModule } from './reminder-templates/reminder-templates.module'
import { BulkMessagesModule } from './bulk-messages/bulk-messages.module'
import { CampaignsModule } from './campaigns/campaigns.module'
import { UploadsModule } from './uploads/uploads.module'
import { PaymentsModule } from './payments/payments.module'
import { EInvoiceModule } from './einvoice/einvoice.module'
import { EncryptionModule } from './common/encryption.module'
import { ZernioModule } from './zernio/zernio.module'
import { AnalyticsModule } from './analytics/analytics.module'
import { ErrorLogModule } from './error-log/error-log.module'
import { HealthCheckModule } from './health-check/health-check.module'
import { AppointmentsModule } from './appointments/appointments.module'
import { ReservationsModule } from './reservations/reservations.module'

@Global()
@Module({
  imports: [
    BullBoardModule.forRoot({
      route: '/admin/queues',
      adapter: ExpressAdapter,
    }),
    LeadModule,
    SystemHealthModule,
    ThrottlerModule.forRoot([{
      ttl: 60000,
      limit: 30,
    }]),
    BullModule.forRootAsync({
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get('REDIS_HOST', 'localhost'),
          port: parseInt(config.get('REDIS_PORT', '6379')),
        },
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: { age: 3600 },
          removeOnFail: { age: 86400 },
        },
      }),
      inject: [ConfigService],
    }),
    PrismaModule, UsersModule, WhatsappModule, TelegramModule, InstagramModule, PushModule,
    OrdersModule, NotificationsModule, MessagesModule, WebchatModule, AuthModule, TenantsModule, ReportScheduleModule,  CommentsModule,  ReminderTemplatesModule,  BulkMessagesModule,  CampaignsModule,  PaymentsModule, UploadsModule,
    EInvoiceModule,
    EncryptionModule, ZernioModule, AnalyticsModule, ErrorLogModule, HealthCheckModule, AppointmentsModule, ReservationsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    ConfigService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
  exports: [ConfigService],
})
export class AppModule {}
