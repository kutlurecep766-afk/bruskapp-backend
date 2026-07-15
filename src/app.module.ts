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
import { PrismaModule } from './prisma.module'
import { TenantsModule } from './tenants/tenants.module'
import { UploadsModule } from './uploads/uploads.module'
import { PaymentsModule } from './payments/payments.module'
import { EInvoiceModule } from './einvoice/einvoice.module'
import { EncryptionModule } from './common/encryption.module'
import { ZernioModule } from './zernio/zernio.module'

@Global()
@Module({
  imports: [
    BullBoardModule.forRoot({
      route: '/admin/queues',
      adapter: ExpressAdapter,
    }),
    LeadModule,
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
    OrdersModule, NotificationsModule, MessagesModule, WebchatModule, AuthModule, TenantsModule, PaymentsModule, UploadsModule,
    EInvoiceModule,
    EncryptionModule, ZernioModule,
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
