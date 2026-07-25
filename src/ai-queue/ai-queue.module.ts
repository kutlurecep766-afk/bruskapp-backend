import { Module } from '@nestjs/common'
import { BullModule } from '@nestjs/bullmq'
import { AiQueueService } from './ai-queue.service'
import { AiQueueProcessor } from './ai-queue.processor'
import { WebchatModule } from '../webchat/webchat.module'
import { MessagesModule } from '../messages/messages.module'
import { InstagramModule } from '../instagram/instagram.module'
import { TelegramModule } from '../telegram/telegram.module'
import { WhatsappModule } from '../whatsapp/whatsapp.module'

@Module({
  imports: [
    BullModule.registerQueue({ name: 'ai-message-processing' }),
    WebchatModule,
    MessagesModule,
    InstagramModule,
    TelegramModule,
    WhatsappModule,
  ],
  providers: [AiQueueService, AiQueueProcessor],
  exports: [AiQueueService],
})
export class AiQueueModule {}
