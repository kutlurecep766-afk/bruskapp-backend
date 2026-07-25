import { Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { MessagesModule } from '../messages/messages.module'
import { WebchatModule } from '../webchat/webchat.module'
import { WhatsappController } from './whatsapp.controller'
import { WhatsappService } from './whatsapp.service'
import { AiQueueModule } from '../ai-queue/ai-queue.module'

@Module({
  imports: [HttpModule, MessagesModule, WebchatModule, AiQueueModule],
  controllers: [WhatsappController],
  providers: [WhatsappService],
  exports: [WhatsappService],
})
export class WhatsappModule {}
