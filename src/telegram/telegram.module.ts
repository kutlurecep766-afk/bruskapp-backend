import { Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { MessagesModule } from '../messages/messages.module'
import { TelegramController } from './telegram.controller'
import { TelegramService } from './telegram.service'

@Module({
  imports: [HttpModule, MessagesModule],
  controllers: [TelegramController],
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}