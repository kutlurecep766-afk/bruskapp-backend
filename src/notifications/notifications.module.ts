import { Module, forwardRef } from '@nestjs/common'
import { NotificationsController } from './notifications.controller'
import { NotificationsService } from './notifications.service'
import { PrismaModule } from '../prisma.module'
import { TelegramModule } from '../telegram/telegram.module'

@Module({
  imports: [PrismaModule, forwardRef(() => TelegramModule)],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
